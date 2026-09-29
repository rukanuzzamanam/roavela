/**
 * Phase 4 integration + security tests: booking holds, server-side pricing, payments, webhooks,
 * cancellation and IDOR. Real PostgreSQL, isolated fixtures. Payments use the development mock
 * provider (no Stripe keys), except the webhook-route suite, which signs real Stripe-format events
 * with a local test secret — no network calls are made.
 */
import { randomBytes } from "node:crypto";
import Stripe from "stripe";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/server/auth/session", () => ({ getCurrentUser: vi.fn(async () => null) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { parseIsoDate } from "@/lib/dates";
import { quoteStay } from "@/lib/pricing";
import { reserveStay } from "@/server/actions/bookings";
import { getCurrentUser } from "@/server/auth/session";
import { prisma } from "@/server/db";
import { processPaymentEvent } from "@/server/payments/events";
import { getActiveFeeSchedule } from "@/server/services/fees";
import { createBookingHold, getGuestBooking, getHostBooking, listHostBookings } from "@/server/services/bookings";
import { cancelBookingAsGuest, getCheckoutBooking, preparePayment, releaseExpiredHolds, simulateMockPayment } from "@/server/services/checkout";
import { searchProperties } from "@/server/services/search";
import { parseSearchParams } from "@/lib/validation/search";

const run = randomBytes(4).toString("hex");
const ids = { destination: "", host: "", hostB: "", guestA: "", guestB: "", property: "", unpublished: "" };
const guestA = () => ({ id: ids.guestA });
const guestB = () => ({ id: ids.guestB });
const req = (checkIn: string, checkOut: string, over: Record<string, unknown> = {}) => ({ propertyId: ids.property, checkIn, checkOut, adults: 2, children: 1, ...over });
const minutes = (n: number) => new Date(Date.now() + n * 60_000);

async function holdOrThrow(guest: { id: string }, r: ReturnType<typeof req>, now?: Date) {
  const res = await createBookingHold(guest, r, now);
  if (!res.ok) throw new Error(`hold failed: ${res.error}`);
  return res.reference;
}

async function confirmedBooking(guest: { id: string }, checkIn: string, checkOut: string) {
  const ref = await holdOrThrow(guest, req(checkIn, checkOut));
  expect((await preparePayment(guest.id, ref)).ok).toBe(true);
  expect(await simulateMockPayment(guest.id, ref, "succeeded")).toMatchObject({ ok: true, outcome: "processed" });
  return ref;
}

const byRef = (reference: string) => prisma.booking.findUniqueOrThrow({ where: { reference }, include: { payments: true } });

beforeAll(async () => {
  ids.destination = (await prisma.destination.create({ data: { slug: `p4-dest-${run}`, name: "P4 Destination", kind: "TOWN", countryCode: "AU", latitude: -32.8, longitude: 151.3, timezone: "Australia/Sydney" } })).id;
  const host = await prisma.user.create({ data: { email: `p4-host-${run}@integration.test`, name: "Hana Host", role: "HOST", hostProfile: { create: { displayName: "Hana" } } }, include: { hostProfile: true } });
  const hostB = await prisma.user.create({ data: { email: `p4-hostb-${run}@integration.test`, name: "Other Host", role: "HOST", hostProfile: { create: { displayName: "Other" } } } });
  ids.host = host.id;
  ids.hostB = hostB.id;
  ids.guestA = (await prisma.user.create({ data: { email: `p4-a-${run}@integration.test`, name: "Alex Traveller", role: "CUSTOMER" } })).id;
  ids.guestB = (await prisma.user.create({ data: { email: `p4-b-${run}@integration.test`, name: "Blair Traveller", role: "CUSTOMER" } })).id;
  const base = {
    hostId: host.hostProfile!.id,
    destinationId: ids.destination,
    summary: "Phase 4 fixture",
    description: "Phase 4 fixture",
    type: "COTTAGE" as const,
    addressLine1: "1 Test Road",
    locality: "Pokolbin",
    adminArea: "NSW",
    countryCode: "AU",
    timezone: "Australia/Sydney",
    bedrooms: 2,
    beds: 2,
    bathrooms: 1,
    maxGuests: 3,
    nightlyPriceCents: 20_000,
    weekendPriceCents: 25_000,
    cleaningFeeCents: 8_000,
    minNights: 2,
    maxNights: 7,
    cancellationPolicy: "MODERATE" as const,
  };
  ids.property = (await prisma.property.create({ data: { ...base, slug: `p4-live-${run}`, title: "P4 Vineyard Cottage", status: "PUBLISHED" } })).id;
  ids.unpublished = (await prisma.property.create({ data: { ...base, slug: `p4-draft-${run}`, title: "P4 Draft", status: "PENDING_REVIEW" } })).id;
});

afterAll(async () => {
  const bookings = await prisma.booking.findMany({ where: { propertyId: { in: [ids.property, ids.unpublished] } }, select: { id: true } });
  const payments = await prisma.payment.findMany({ where: { bookingId: { in: bookings.map((b) => b.id) } }, select: { id: true } });
  await prisma.webhookEvent.deleteMany({ where: { OR: [{ paymentId: { in: payments.map((p) => p.id) } }, { externalEventId: { contains: run } }] } });
  await prisma.payment.deleteMany({ where: { id: { in: payments.map((p) => p.id) } } });
  await prisma.booking.deleteMany({ where: { id: { in: bookings.map((b) => b.id) } } });
  await prisma.blockedDate.deleteMany({ where: { propertyId: ids.property } });
  await prisma.property.deleteMany({ where: { id: { in: [ids.property, ids.unpublished] } } });
  await prisma.user.deleteMany({ where: { id: { in: [ids.host, ids.hostB, ids.guestA, ids.guestB] } } });
  await prisma.destination.deleteMany({ where: { id: ids.destination } });
  await prisma.$disconnect();
});

describe("server-owned pricing and the quote snapshot", () => {
  it("prices on the server, snapshots the rules and holds the dates for 20 minutes", async () => {
    const ref = await holdOrThrow(guestA(), req("2027-01-01", "2027-01-03")); // Fri + Sat nights
    const b = await byRef(ref);
    const fees = await getActiveFeeSchedule("AU");
    const expected = quoteStay(parseIsoDate("2027-01-01"), parseIsoDate("2027-01-03"), { nightlyPriceCents: 20_000, weekendPriceCents: 25_000, cleaningFeeCents: 8_000 }, fees);

    expect(ref).toMatch(/^ROA-[2-9A-HJKMNP-Z]{6}$/);
    expect(b).toMatchObject({
      status: "PENDING",
      currency: "AUD",
      nights: 2,
      adults: 2,
      children: 1,
      accommodationCents: 50_000,
      cleaningFeeCents: 8_000,
      totalCents: expected.guestTotalCents,
      hostCommissionCents: expected.hostCommissionCents,
      hostPayoutCents: 50_000 - expected.hostCommissionCents + 8_000,
      guestServiceFeeBps: fees.guestServiceFeeBps,
      hostCommissionBps: fees.hostCommissionBps,
      feeScheduleId: fees.id,
      cancellationPolicy: "MODERATE",
    });
    expect(b.totalCents).toBe(b.hostPayoutCents + b.platformRevenueCents);
    expect(b.pricingSnapshot).toMatchObject({ rulesVersion: "2026-09.accommodation-fee-base", feeSchedule: { id: fees.id }, feeBaseCents: 50_000 });
    expect(b.houseRulesSnapshot).toMatchObject({ checkInTime: "15:00" });
    const holdMs = b.expiresAt!.getTime() - b.createdAt.getTime();
    expect(holdMs).toBeGreaterThan(19 * 60_000);
    expect(holdMs).toBeLessThanOrEqual(20 * 60_000 + 5_000);
  });

  it("ignores client-supplied price, commission, currency and status (via the Server Action)", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue({ id: ids.guestB, email: "b@x", name: "Blair", role: "CUSTOMER" } as never);
    const fd = new FormData();
    for (const [k, v] of Object.entries({ ...req("2027-01-11", "2027-01-13"), totalCents: "1", nightlyRate: "1", hostCommissionBps: "0", platformFeeCents: "0", currency: "USD", status: "CONFIRMED" })) fd.set(k, String(v));
    const digest = await reserveStay({}, fd).then(
      () => "",
      (e: { digest?: string }) => e.digest ?? "",
    );
    const ref = /\/checkout\/(ROA-[A-Z0-9]{6})/.exec(digest)?.[1];
    expect(ref, "redirects to checkout").toBeTruthy();
    const b = await byRef(ref!);
    expect(b.status).toBe("PENDING");
    expect(b.currency).toBe("AUD");
    expect(b.accommodationCents).toBe(40_000);
    expect(b.totalCents).toBeGreaterThan(40_000);
    expect(b.hostCommissionBps).toBe((await getActiveFeeSchedule("AU")).hostCommissionBps);
    vi.mocked(getCurrentUser).mockResolvedValue(null);
  });

  it("is idempotent for repeated and concurrent submits by the same guest", async () => {
    const r = req("2027-01-20", "2027-01-22");
    const results = await Promise.all([createBookingHold(guestA(), r), createBookingHold(guestA(), r), createBookingHold(guestA(), r)]);
    const refs = new Set(results.map((x) => (x.ok ? x.reference : x.error)));
    expect(refs.size).toBe(1);
    expect(await prisma.booking.count({ where: { propertyId: ids.property, guestId: ids.guestA, checkIn: parseIsoDate("2027-01-20") } })).toBe(1);
  });
});

describe("server-side availability and validation", () => {
  it("rejects too many guests, stays outside min/max nights, and bad dates", async () => {
    expect(await createBookingHold(guestA(), req("2027-02-01", "2027-02-03", { adults: 3, children: 1 }))).toMatchObject({ ok: false });
    expect(await createBookingHold(guestA(), req("2027-02-01", "2027-02-02"))).toMatchObject({ ok: false, error: expect.stringMatching(/2-night minimum/) });
    expect(await createBookingHold(guestA(), req("2027-02-01", "2027-02-10"))).toMatchObject({ ok: false, error: expect.stringMatching(/up to 7 nights/) });
    expect(await createBookingHold(guestA(), req("2027-02-03", "2027-02-01"))).toMatchObject({ ok: false, code: "dates" });
    expect(await createBookingHold(guestA(), req("2027-02-30", "2027-03-02"))).toMatchObject({ ok: false, code: "invalid" });
    expect(await createBookingHold(guestA(), req("2020-02-01", "2020-02-03"))).toMatchObject({ ok: false, code: "dates" });
    expect(await createBookingHold(guestA(), req("2029-02-01", "2029-02-03"))).toMatchObject({ ok: false, code: "dates" });
  });

  it("refuses unpublished listings and hosts booking their own listing", async () => {
    expect(await createBookingHold(guestA(), { ...req("2027-02-01", "2027-02-03"), propertyId: ids.unpublished })).toMatchObject({ ok: false, code: "not_found" });
    expect(await createBookingHold({ id: ids.host }, req("2027-02-01", "2027-02-03"))).toMatchObject({ ok: false, code: "own_listing" });
  });

  it("refuses host-blocked dates", async () => {
    await prisma.blockedDate.create({ data: { propertyId: ids.property, startDate: parseIsoDate("2027-02-20"), endDate: parseIsoDate("2027-02-22") } });
    expect(await createBookingHold(guestA(), req("2027-02-21", "2027-02-23"))).toMatchObject({ ok: false, code: "unavailable" });
  });

  it("Customer A (10–12) vs Customer B (11–13) at the same moment: exactly one wins", async () => {
    const [a, b] = await Promise.all([createBookingHold(guestA(), req("2027-03-10", "2027-03-12")), createBookingHold(guestB(), req("2027-03-11", "2027-03-13"))]);
    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
    expect([a, b].find((x) => !x.ok)).toMatchObject({ code: "unavailable" });
  });

  it("a live hold blocks others; once lapsed, the dates are released to the next guest", async () => {
    const refA = await holdOrThrow(guestA(), req("2027-03-20", "2027-03-22"));
    expect(await createBookingHold(guestB(), req("2027-03-21", "2027-03-23"))).toMatchObject({ ok: false, code: "unavailable" });
    const later = minutes(21);
    const refB = await holdOrThrow(guestB(), req("2027-03-21", "2027-03-23"), later);
    expect((await byRef(refA)).status).toBe("EXPIRED");
    expect((await byRef(refB)).status).toBe("PENDING");
  });
});

describe("payments (simulated provider → same event pipeline as Stripe)", () => {
  it("creates exactly one payment for the server amount, however often checkout is opened", async () => {
    const ref = await holdOrThrow(guestA(), req("2027-04-01", "2027-04-03"));
    const results = await Promise.all([preparePayment(ids.guestA, ref), preparePayment(ids.guestA, ref), preparePayment(ids.guestA, ref)]);
    expect(results.every((r) => r.ok)).toBe(true);
    const b = await byRef(ref);
    expect(b.payments).toHaveLength(1);
    expect(b.payments[0]).toMatchObject({ provider: "mock", amountCents: b.totalCents, currency: "AUD", status: "REQUIRES_PAYMENT" });
    expect(b.status).toBe("PENDING"); // starting payment never confirms anything
  });

  it("a verified success confirms the booking once; a duplicate event changes nothing", async () => {
    const ref = await confirmedBooking(guestA(), "2027-04-10", "2027-04-12");
    const b = await byRef(ref);
    expect(b.status).toBe("CONFIRMED");
    expect(b.confirmedAt).toBeTruthy();
    expect(b.payments[0]!.status).toBe("SUCCEEDED");

    const ev = { provider: "mock" as const, eventId: `evt_dup_${run}`, eventType: "payment_intent.succeeded", kind: "succeeded" as const, providerPaymentId: b.payments[0]!.providerPaymentId, amountCents: b.totalCents, currency: "aud", reference: ref };
    expect((await processPaymentEvent(ev)).outcome).toBe("processed"); // different event id, already applied → no-op
    expect((await processPaymentEvent(ev)).outcome).toBe("duplicate");
    const concurrent = await Promise.all([processPaymentEvent({ ...ev, eventId: `evt_c_${run}` }), processPaymentEvent({ ...ev, eventId: `evt_c_${run}` })]);
    expect(concurrent.map((r) => r.outcome).sort()).toEqual(["duplicate", "processed"]);
    expect(await prisma.webhookEvent.count({ where: { externalEventId: `evt_c_${run}` } })).toBe(1);
  });

  it("confirmed dates are unavailable to everyone else (search and booking)", async () => {
    await confirmedBooking(guestA(), "2027-04-20", "2027-04-22");
    expect(await createBookingHold(guestB(), req("2027-04-21", "2027-04-23"))).toMatchObject({ ok: false, code: "unavailable" });
    const found = await searchProperties(parseSearchParams({ checkIn: "2027-04-21", checkOut: "2027-04-23", adults: "2" }), { propertyIds: [ids.property] });
    expect(found.results.map((r) => r.id)).not.toContain(ids.property);
  });

  it("a failed payment never confirms, and never locks the dates beyond the hold", async () => {
    const ref = await holdOrThrow(guestA(), req("2027-05-01", "2027-05-03"));
    await preparePayment(ids.guestA, ref);
    await simulateMockPayment(ids.guestA, ref, "failed");
    let b = await byRef(ref);
    expect(b.status).toBe("PENDING");
    expect(b.payments[0]).toMatchObject({ status: "FAILED", failureCode: "card_declined" });

    const later = minutes(25);
    const released = await releaseExpiredHolds(later);
    expect(released.expired).toBeGreaterThanOrEqual(1);
    b = await byRef(ref);
    expect(b.status).toBe("EXPIRED");
    expect(b.payments[0]!.status).toBe("CANCELLED");
    expect(await createBookingHold(guestB(), req("2027-05-01", "2027-05-03"), later)).toMatchObject({ ok: true });
  });

  it("rejects events whose amount, currency or booking reference don't match our records", async () => {
    const ref = await holdOrThrow(guestA(), req("2027-05-10", "2027-05-12"));
    await preparePayment(ids.guestA, ref);
    const p = (await byRef(ref)).payments[0]!;
    const base = { provider: "mock" as const, eventType: "payment_intent.succeeded", kind: "succeeded" as const, providerPaymentId: p.providerPaymentId, amountCents: p.amountCents, currency: "aud", reference: ref };
    expect((await processPaymentEvent({ ...base, eventId: `evt_amt_${run}`, amountCents: 100 })).outcome).toBe("rejected");
    expect((await processPaymentEvent({ ...base, eventId: `evt_cur_${run}`, currency: "usd" })).outcome).toBe("rejected");
    expect((await processPaymentEvent({ ...base, eventId: `evt_ref_${run}`, reference: "ROA-ZZZZZZ" })).outcome).toBe("rejected");
    expect((await processPaymentEvent({ ...base, eventId: `evt_unk_${run}`, providerPaymentId: "mock_pi_unknown" })).outcome).toBe("ignored");
    expect((await byRef(ref)).status).toBe("PENDING");
    expect(await prisma.webhookEvent.findUnique({ where: { provider_externalEventId: { provider: "mock", externalEventId: `evt_amt_${run}` } } })).toMatchObject({ status: "FAILED", message: "Amount mismatch" });
  });

  it("handles out-of-order events: a failure after success is ignored", async () => {
    const ref = await confirmedBooking(guestA(), "2027-05-20", "2027-05-22");
    const p = (await byRef(ref)).payments[0]!;
    const r = await processPaymentEvent({ provider: "mock", eventId: `evt_late_fail_${run}`, eventType: "payment_intent.payment_failed", kind: "failed", providerPaymentId: p.providerPaymentId, currency: "aud", reference: ref, failureCode: "card_declined" });
    expect(r.message).toMatch(/Ignored/);
    const b = await byRef(ref);
    expect(b.status).toBe("CONFIRMED");
    expect(b.payments[0]!.status).toBe("SUCCEEDED");
  });

  it("a payment that lands after the hold lapsed: confirms if the dates are free, refunds if they're not", async () => {
    // Free dates → confirmed.
    const free = await holdOrThrow(guestA(), req("2027-06-01", "2027-06-03"));
    await preparePayment(ids.guestA, free);
    await prisma.booking.update({ where: { reference: free }, data: { status: "EXPIRED" } });
    await simulateMockPayment(ids.guestA, free, "succeeded");
    expect((await byRef(free)).status).toBe("CONFIRMED");

    // Dates taken by someone else in the meantime → never double-booked; full refund requested.
    const late = await holdOrThrow(guestA(), req("2027-06-10", "2027-06-12"));
    await preparePayment(ids.guestA, late);
    const other = await holdOrThrow(guestB(), req("2027-06-10", "2027-06-12"), minutes(21));
    await simulateMockPayment(ids.guestA, late, "succeeded");
    const b = await byRef(late);
    expect(b.status).toBe("EXPIRED");
    expect(b.payments[0]).toMatchObject({ status: "REFUNDED", refundedCents: b.totalCents });
    expect((await byRef(other)).status).toBe("PENDING");
  });
});

describe("cancellation and refunds", () => {
  it("MODERATE, far ahead: full refund → REFUND_PENDING → REFUNDED once the provider confirms", async () => {
    const ref = await confirmedBooking(guestA(), "2027-07-01", "2027-07-03");
    const res = await cancelBookingAsGuest(ids.guestA, ref);
    const b = await byRef(ref);
    expect(res).toMatchObject({ ok: true, status: "REFUND_PENDING", refundCents: b.totalCents });
    // The mock provider reports the refund through the event pipeline, exactly like charge.refunded.
    expect(b.status).toBe("REFUNDED");
    expect(b.refundDueCents).toBe(b.totalCents);
    expect(b.payments[0]).toMatchObject({ status: "REFUNDED", refundedCents: b.totalCents });
    // Cancelled dates are free again; a second cancel is refused.
    expect(await createBookingHold(guestB(), req("2027-07-01", "2027-07-03"))).toMatchObject({ ok: true });
    expect(await cancelBookingAsGuest(ids.guestA, ref)).toMatchObject({ ok: false });
  });

  it("MODERATE within 5 days: partial refund of 50% accommodation + cleaning", async () => {
    const ref = await confirmedBooking(guestA(), "2027-07-10", "2027-07-12");
    const b0 = await byRef(ref);
    const res = await cancelBookingAsGuest(ids.guestA, ref, new Date("2027-07-07T00:00:00Z"));
    expect(res).toMatchObject({ ok: true, refundCents: Math.floor(b0.accommodationCents / 2) + b0.cleaningFeeCents });
    const b = await byRef(ref);
    expect(b.payments[0]!.status).toBe("PARTIALLY_REFUNDED");
    expect(b.status).toBe("REFUNDED");
  });
});

describe("IDOR: customers and hosts only ever see their own bookings", () => {
  let ref = "";
  beforeAll(async () => {
    ref = await confirmedBooking(guestA(), "2027-08-01", "2027-08-03");
  });

  it("another customer can't view, pay for, simulate or cancel it", async () => {
    expect(await getGuestBooking(ids.guestB, ref)).toBeNull();
    expect(await getCheckoutBooking(ids.guestB, ref)).toBeNull();
    expect(await preparePayment(ids.guestB, ref)).toMatchObject({ ok: false, state: "not_found" });
    expect(await simulateMockPayment(ids.guestB, ref, "succeeded")).toMatchObject({ ok: false });
    expect(await cancelBookingAsGuest(ids.guestB, ref)).toMatchObject({ ok: false, error: "Booking not found." });
    expect((await byRef(ref)).status).toBe("CONFIRMED");
  });

  it("another host can't see it; the owning host sees first name and proceeds only", async () => {
    expect(await getHostBooking(ids.hostB, ref)).toBeNull();
    expect((await listHostBookings(ids.hostB)).map((b) => b.reference)).not.toContain(ref);
    const view = await getHostBooking(ids.host, ref);
    expect(view).toMatchObject({ reference: ref, guestFirstName: "Alex", status: "CONFIRMED" });
    expect(JSON.stringify(view)).not.toMatch(/integration\.test|Traveller/);
    expect(view).not.toHaveProperty("totalCents");
  });

  it("hosts never see unpaid checkout holds", async () => {
    const pending = await holdOrThrow(guestB(), req("2027-08-10", "2027-08-12"));
    expect(await getHostBooking(ids.host, pending)).toBeNull();
  });

  it("malformed references are rejected before touching the database", async () => {
    expect(await getGuestBooking(ids.guestA, "' OR 1=1 --")).toBeNull();
  });
});

describe("Stripe webhook route (signed test events, no network)", () => {
  const secret = `whsec_it_${run}`;
  const saved: Record<string, string | undefined> = {};
  const keys = ["STRIPE_SECRET_KEY", "NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY", "STRIPE_WEBHOOK_SECRET", "STRIPE_MODE"] as const;
  let POST: (r: import("next/server").NextRequest) => Promise<Response>;
  let NextRequestCtor: typeof import("next/server").NextRequest;

  beforeAll(async () => {
    for (const k of keys) saved[k] = process.env[k];
    Object.assign(process.env, { STRIPE_SECRET_KEY: "sk_test_integration_dummy", NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: "pk_test_integration_dummy", STRIPE_WEBHOOK_SECRET: secret, STRIPE_MODE: "test" });
    ({ POST } = await import("@/app/api/webhooks/stripe/route"));
    ({ NextRequest: NextRequestCtor } = await import("next/server"));
  });
  afterAll(() => {
    for (const k of keys) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  async function stripeHold(checkIn: string, checkOut: string) {
    const ref = await holdOrThrow(guestA(), req(checkIn, checkOut));
    const b = await byRef(ref);
    const pi = `pi_it_${run}_${randomBytes(3).toString("hex")}`;
    await prisma.payment.create({ data: { bookingId: b.id, provider: "stripe", providerPaymentId: pi, amountCents: b.totalCents, currency: "AUD" } });
    return { ref, pi, total: b.totalCents };
  }
  const event = (id: string, type: string, object: Record<string, unknown>, livemode = false) => JSON.stringify({ id, object: "event", type, livemode, data: { object } });
  const send = (payload: string, signature: string | null) =>
    POST(new NextRequestCtor("http://localhost/api/webhooks/stripe", { method: "POST", body: payload, headers: signature ? { "stripe-signature": signature } : {} }));
  const sign = (payload: string, s = secret) => Stripe.webhooks.generateTestHeaderString({ payload, secret: s });

  it("rejects unsigned, wrongly signed and tampered requests without touching bookings", async () => {
    const { ref, pi, total } = await stripeHold("2027-09-01", "2027-09-03");
    const payload = event(`evt_sig_${run}`, "payment_intent.succeeded", { id: pi, object: "payment_intent", amount_received: total, currency: "aud", metadata: { bookingReference: ref } });
    expect((await send(payload, null)).status).toBe(400);
    expect((await send(payload, sign(payload, "whsec_wrong"))).status).toBe(400);
    expect((await send(payload.replace(String(total), "100"), sign(payload))).status).toBe(400);
    expect((await byRef(ref)).status).toBe("PENDING");
  });

  it("confirms on a verified payment_intent.succeeded, and acknowledges a redelivery as a duplicate", async () => {
    const { ref, pi, total } = await stripeHold("2027-09-10", "2027-09-12");
    const payload = event(`evt_ok_${run}`, "payment_intent.succeeded", { id: pi, object: "payment_intent", amount_received: total, currency: "aud", metadata: { bookingReference: ref } });
    const first = await send(payload, sign(payload));
    expect(first.status).toBe(200);
    expect(await first.json()).toMatchObject({ outcome: "processed" });
    expect((await byRef(ref)).status).toBe("CONFIRMED");
    expect(await (await send(payload, sign(payload))).json()).toMatchObject({ outcome: "duplicate" });
  });

  it("never confirms on a wrong amount, a missing reference or a livemode event", async () => {
    const { ref, pi, total } = await stripeHold("2027-09-20", "2027-09-22");
    const wrong = event(`evt_wrong_${run}`, "payment_intent.succeeded", { id: pi, object: "payment_intent", amount_received: total - 1, currency: "aud", metadata: { bookingReference: ref } });
    expect(await (await send(wrong, sign(wrong))).json()).toMatchObject({ outcome: "rejected" });
    const noRef = event(`evt_noref_${run}`, "payment_intent.succeeded", { id: pi, object: "payment_intent", amount_received: total, currency: "aud", metadata: {} });
    expect(await (await send(noRef, sign(noRef))).json()).toMatchObject({ outcome: "rejected" });
    const live = event(`evt_live_${run}`, "payment_intent.succeeded", { id: pi, object: "payment_intent", amount_received: total, currency: "aud", metadata: { bookingReference: ref } }, true);
    expect(await (await send(live, sign(live))).json()).toMatchObject({ outcome: "rejected" });
    expect((await byRef(ref)).status).toBe("PENDING");
  });

  it("records a payment_intent.payment_failed without confirming", async () => {
    const { ref, pi } = await stripeHold("2027-10-01", "2027-10-03");
    const payload = event(`evt_fail_${run}`, "payment_intent.payment_failed", { id: pi, object: "payment_intent", currency: "aud", metadata: { bookingReference: ref }, last_payment_error: { code: "card_declined", decline_code: "generic_decline" } });
    expect((await send(payload, sign(payload))).status).toBe(200);
    const b = await byRef(ref);
    expect(b.status).toBe("PENDING");
    expect(b.payments[0]).toMatchObject({ status: "FAILED", failureCode: "generic_decline" });
  });

  it("stores no payloads — only ids, type and outcome", async () => {
    const row = await prisma.webhookEvent.findUniqueOrThrow({ where: { provider_externalEventId: { provider: "stripe", externalEventId: `evt_ok_${run}` } } });
    expect(Object.keys(row).sort()).toEqual(["eventType", "externalEventId", "id", "message", "paymentId", "processedAt", "provider", "receivedAt", "status"]);
  });
});
