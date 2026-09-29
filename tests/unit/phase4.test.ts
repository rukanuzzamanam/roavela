import Stripe from "stripe";
import { describe, expect, it } from "vitest";
import { CANCELLATION_COPY } from "@/config/policies";
import { bookingPriceLines, bookingTransition, houseRulesList, quoteCancellation, type BookingEvent } from "@/lib/booking-lifecycle";
import { parseIsoDate } from "@/lib/dates";
import { evaluatePaymentConfig } from "@/lib/payment-config";
import { quoteStay, splitStayAmounts } from "@/lib/pricing";
import { generateBookingReference, REFERENCE_PATTERN } from "@/server/booking-reference";
import { redact } from "@/server/log";
import { toPaymentEvent, verifyStripeEvent } from "@/server/payments/stripe-events";
import { bookingRequestSchema, bookingTab, firstName } from "@/lib/validation/booking";

describe("commission rule (accommodation-only fee base)", () => {
  it("matches the worked example: 500 + 80 cleaning → guest 610, host 560, platform 50", () => {
    const split = splitStayAmounts(50_000, 8_000, { guestServiceFeeBps: 600, hostCommissionBps: 400 });
    expect(split).toMatchObject({
      feeBaseCents: 50_000,
      guestServiceFeeCents: 3_000,
      guestTotalCents: 61_000,
      hostCommissionCents: 2_000,
      hostPayoutCents: 56_000,
      platformRevenueCents: 5_000,
    });
    // No commission on cleaning, and the books always balance.
    expect(split.guestTotalCents).toBe(split.hostPayoutCents + split.platformRevenueCents);
  });

  it("changing the cleaning fee never changes Roavela's fees", () => {
    const rates = { guestServiceFeeBps: 600, hostCommissionBps: 400 };
    const a = splitStayAmounts(50_000, 0, rates);
    const b = splitStayAmounts(50_000, 20_000, rates);
    expect(b.platformRevenueCents).toBe(a.platformRevenueCents);
    expect(b.hostPayoutCents - a.hostPayoutCents).toBe(20_000);
  });

  it("computes weekend nights server-side from dates, not from any client value", () => {
    // Fri 2027-01-01 and Sat 2027-01-02 are weekend nights.
    const q = quoteStay(parseIsoDate("2027-01-01"), parseIsoDate("2027-01-03"), { nightlyPriceCents: 20_000, weekendPriceCents: 25_000, cleaningFeeCents: 8_000 }, { guestServiceFeeBps: 600, hostCommissionBps: 400 });
    expect(q.nights).toBe(2);
    expect(q.accommodationCents).toBe(50_000);
    expect(q.guestTotalCents).toBe(61_000);
  });
});

describe("booking lifecycle", () => {
  const all = ["PENDING", "CONFIRMED", "CANCELLED", "COMPLETED", "REFUNDED", "EXPIRED", "REFUND_PENDING"] as const;
  const legal: Record<BookingEvent, Partial<Record<(typeof all)[number], string>>> = {
    payment_confirmed: { PENDING: "CONFIRMED", EXPIRED: "CONFIRMED" },
    hold_expired: { PENDING: "EXPIRED" },
    cancel_no_refund: { CONFIRMED: "CANCELLED" },
    cancel_with_refund: { CONFIRMED: "REFUND_PENDING" },
    refund_confirmed: { REFUND_PENDING: "REFUNDED" },
    stay_completed: { CONFIRMED: "COMPLETED" },
  };

  it("allows exactly the documented transitions and nothing else", () => {
    for (const [event, table] of Object.entries(legal) as [BookingEvent, Record<string, string>][]) {
      for (const from of all) expect(bookingTransition(event, from), `${event} from ${from}`).toBe(table[from] ?? null);
    }
  });

  it("never lets a cancelled, refunded or completed booking be re-confirmed", () => {
    for (const from of ["CANCELLED", "REFUNDED", "REFUND_PENDING", "COMPLETED"] as const) expect(bookingTransition("payment_confirmed", from)).toBeNull();
  });
});

describe("cancellation refunds (policy snapshot)", () => {
  const booking = { checkIn: parseIsoDate("2027-03-20"), totalCents: 61_000, accommodationCents: 50_000, cleaningFeeCents: 8_000 };
  const on = (iso: string) => parseIsoDate(iso);

  it("FLEXIBLE: full refund up to the day before, nothing on the day", () => {
    expect(quoteCancellation("FLEXIBLE", booking, on("2027-03-19")).refundCents).toBe(61_000);
    expect(quoteCancellation("FLEXIBLE", booking, on("2027-03-20")).refundCents).toBe(0);
  });

  it("MODERATE: full refund 5+ days out, then 50% accommodation + cleaning", () => {
    expect(quoteCancellation("MODERATE", booking, on("2027-03-15")).refundCents).toBe(61_000);
    expect(quoteCancellation("MODERATE", booking, on("2027-03-16")).refundCents).toBe(25_000 + 8_000);
  });

  it("STRICT: partial refund 14+ days out, then nothing", () => {
    expect(quoteCancellation("STRICT", booking, on("2027-03-06")).refundCents).toBe(33_000);
    expect(quoteCancellation("STRICT", booking, on("2027-03-07")).refundCents).toBe(0);
  });

  it("refunds nothing once the stay has started", () => {
    expect(quoteCancellation("FLEXIBLE", booking, on("2027-03-21"))).toMatchObject({ eligibility: "none", refundCents: 0 });
  });

  it("never refunds more than the guest paid", () => {
    for (const policy of ["FLEXIBLE", "MODERATE", "STRICT"] as const) {
      for (const day of ["2027-01-01", "2027-03-10", "2027-03-19", "2027-03-20"]) {
        expect(quoteCancellation(policy, booking, on(day)).refundCents).toBeLessThanOrEqual(booking.totalCents);
      }
    }
  });

  it("guest-facing copy describes the enforced rules", () => {
    expect(CANCELLATION_COPY.MODERATE.body).toMatch(/5\+ days/);
    expect(CANCELLATION_COPY.STRICT.body).toMatch(/14\+ days/);
  });
});

describe("payment configuration guard (TEST MODE ONLY)", () => {
  const test = { STRIPE_SECRET_KEY: "sk_test_abc", NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: "pk_test_abc", STRIPE_WEBHOOK_SECRET: "whsec_abc" };

  it("accepts a complete test-mode configuration", () => {
    expect(evaluatePaymentConfig({ ...test, STRIPE_MODE: "test" })).toMatchObject({ ok: true, provider: "stripe" });
  });

  it("refuses live keys in any variable", () => {
    for (const env of [
      { ...test, STRIPE_SECRET_KEY: "sk_live_abc" },
      { ...test, STRIPE_SECRET_KEY: "rk_live_abc" },
      { ...test, NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: "pk_live_abc" },
    ]) {
      const r = evaluatePaymentConfig(env);
      expect(r.ok).toBe(false);
      expect(r.ok === false && r.error).toMatch(/Live/);
    }
  });

  it("refuses any STRIPE_MODE other than test", () => {
    expect(evaluatePaymentConfig({ ...test, STRIPE_MODE: "live" }).ok).toBe(false);
  });

  it("requires every Stripe value once a secret key is set", () => {
    expect(evaluatePaymentConfig({ ...test, NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: "" }).ok).toBe(false);
    expect(evaluatePaymentConfig({ ...test, STRIPE_WEBHOOK_SECRET: "" }).ok).toBe(false);
    expect(evaluatePaymentConfig({ ...test, STRIPE_SECRET_KEY: "not-a-key" }).ok).toBe(false);
  });

  it("uses the simulated provider without keys in development, and refuses it in production", () => {
    expect(evaluatePaymentConfig({ NODE_ENV: "development" })).toEqual({ ok: true, provider: "mock" });
    expect(evaluatePaymentConfig({ NODE_ENV: "production" }).ok).toBe(false);
    expect(evaluatePaymentConfig({ NODE_ENV: "production", PAYMENT_PROVIDER: "mock" }).ok).toBe(false);
  });
});

describe("booking references", () => {
  it("are ROA- plus 6 unambiguous characters", () => {
    for (let i = 0; i < 200; i++) expect(generateBookingReference()).toMatch(REFERENCE_PATTERN);
  });

  it("are unpredictable (no collisions in 20k draws)", () => {
    const seen = new Set(Array.from({ length: 20_000 }, generateBookingReference));
    expect(seen.size).toBeGreaterThan(19_990); // 31^6 ≈ 887M combinations
  });
});

describe("booking request input", () => {
  it("strips anything that isn't the guest's choice (price, status, commission, currency)", () => {
    const parsed = bookingRequestSchema.parse({
      propertyId: "p1",
      checkIn: "2027-01-01",
      checkOut: "2027-01-03",
      adults: "2",
      children: "1",
      totalCents: 1,
      status: "CONFIRMED",
      hostCommissionBps: 0,
      currency: "USD",
      nightlyRate: 1,
    });
    expect(parsed).toEqual({ propertyId: "p1", checkIn: "2027-01-01", checkOut: "2027-01-03", adults: 2, children: 1 });
  });

  it("rejects impossible dates and party sizes", () => {
    expect(bookingRequestSchema.safeParse({ propertyId: "p", checkIn: "2027-02-30", checkOut: "2027-03-02", adults: 2 }).success).toBe(false);
    expect(bookingRequestSchema.safeParse({ propertyId: "p", checkIn: "2027-02-01", checkOut: "2027-02-03", adults: 0 }).success).toBe(false);
    expect(bookingRequestSchema.safeParse({ propertyId: "p", checkIn: "2027-02-01", checkOut: "2027-02-03", adults: 2, children: -1 }).success).toBe(false);
  });
});

describe("booking display helpers", () => {
  it("groups trips into upcoming / past / cancelled", () => {
    const today = parseIsoDate("2027-01-10");
    const now = new Date("2027-01-10T01:00:00Z");
    expect(bookingTab({ status: "CONFIRMED", checkOut: parseIsoDate("2027-01-12"), expiresAt: null }, today, now)).toBe("upcoming");
    expect(bookingTab({ status: "CONFIRMED", checkOut: parseIsoDate("2027-01-10"), expiresAt: null }, today, now)).toBe("past");
    expect(bookingTab({ status: "PENDING", checkOut: parseIsoDate("2027-01-12"), expiresAt: new Date("2027-01-10T00:30:00Z") }, today, now)).toBe("cancelled");
    expect(bookingTab({ status: "REFUND_PENDING", checkOut: parseIsoDate("2027-01-12"), expiresAt: null }, today, now)).toBe("cancelled");
  });

  it("shows hosts the guest's first name only", () => {
    expect(firstName("  Jordan   Avery Smith ")).toBe("Jordan");
  });

  it("reads price lines from the booking snapshot", () => {
    const lines = bookingPriceLines({
      nights: 2,
      accommodationCents: 50_000,
      cleaningFeeCents: 8_000,
      guestServiceFeeCents: 3_000,
      totalCents: 61_000,
      pricingSnapshot: { nightlyRates: [{ date: "2027-01-01", cents: 25_000 }, { date: "2027-01-02", cents: 25_000 }] },
    });
    expect(lines.guestTotalCents).toBe(61_000);
    expect(lines.nightlyRates).toHaveLength(2);
    expect(houseRulesList(null)).toEqual([]);
  });
});

describe("structured logging", () => {
  it("redacts secrets and personal data", () => {
    const out = redact({ reference: "ROA-ABCDEF", email: "a@b.com", note: "key sk_test_12345 and whsec_abcdef", clientSecret: "pi_1_secret_2", amountCents: 100 });
    expect(out).toEqual({ reference: "ROA-ABCDEF", email: "[redacted]", note: "key [redacted] and [redacted]", clientSecret: "[redacted]", amountCents: 100 });
  });
});

describe("Stripe webhook verification and mapping", () => {
  const secret = "whsec_unit_test_secret";
  const succeeded = {
    id: "evt_unit_1",
    object: "event",
    type: "payment_intent.succeeded",
    livemode: false,
    data: { object: { id: "pi_unit_1", object: "payment_intent", amount: 61_000, amount_received: 61_000, currency: "aud", metadata: { bookingReference: "ROA-ABCDEF" } } },
  };
  const sign = (payload: string, s = secret) => Stripe.webhooks.generateTestHeaderString({ payload, secret: s });

  it("accepts a correctly signed payload and maps it", () => {
    const payload = JSON.stringify(succeeded);
    const event = verifyStripeEvent(payload, sign(payload), secret);
    expect(toPaymentEvent(event)).toMatchObject({ provider: "stripe", eventId: "evt_unit_1", kind: "succeeded", providerPaymentId: "pi_unit_1", amountCents: 61_000, currency: "aud", reference: "ROA-ABCDEF" });
  });

  it("rejects a wrong secret, a tampered body and a missing signature", () => {
    const payload = JSON.stringify(succeeded);
    expect(() => verifyStripeEvent(payload, sign(payload, "whsec_other"), secret)).toThrow();
    const tampered = payload.replace("61000", "1");
    expect(() => verifyStripeEvent(tampered, sign(payload), secret)).toThrow();
    expect(() => verifyStripeEvent(payload, "", secret)).toThrow();
  });

  it("rejects replayed (stale) signatures", () => {
    const payload = JSON.stringify(succeeded);
    const old = Stripe.webhooks.generateTestHeaderString({ payload, secret, timestamp: Math.floor(Date.now() / 1000) - 3600 });
    expect(() => verifyStripeEvent(payload, old, secret)).toThrow();
  });

  it("maps failures to a code only, refunds cumulatively, and ignores other events", () => {
    const failed = { ...succeeded, id: "evt_unit_2", type: "payment_intent.payment_failed", data: { object: { ...succeeded.data.object, last_payment_error: { code: "card_declined", decline_code: "insufficient_funds", message: "Your card has insufficient funds." } } } };
    expect(toPaymentEvent(failed as unknown as Stripe.Event)).toMatchObject({ kind: "failed", failureCode: "insufficient_funds" });
    const refunded = { ...succeeded, id: "evt_unit_3", type: "charge.refunded", data: { object: { id: "ch_1", object: "charge", payment_intent: "pi_unit_1", amount_refunded: 33_000, currency: "aud" } } };
    expect(toPaymentEvent(refunded as unknown as Stripe.Event)).toMatchObject({ kind: "refunded", providerPaymentId: "pi_unit_1", refundedCents: 33_000 });
    expect(toPaymentEvent({ ...succeeded, type: "customer.created" } as unknown as Stripe.Event)).toMatchObject({ kind: "ignored", providerPaymentId: null });
  });
});
