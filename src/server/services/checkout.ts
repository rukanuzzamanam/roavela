import "server-only";
import { randomBytes } from "node:crypto";
import { bookingTransition, quoteCancellation } from "@/lib/booking-lifecycle";
import { nightsBetween, todayInTimeZone } from "@/lib/dates";
import { prisma } from "@/server/db";
import { isUniqueViolation } from "@/server/db-errors";
import { bookingCancelledEmail, sendBookingEmail } from "@/server/emails/booking-emails";
import { env } from "@/server/env";
import { errorFields, log } from "@/server/log";
import { processPaymentEvent, requestRefund } from "@/server/payments/events";
import { getPaymentProvider } from "@/server/payments/provider";
import { track } from "@/server/providers/analytics";
import { isPlausibleReference } from "@/lib/validation/booking";

/**
 * Checkout, payment start, hold expiry and guest cancellation. Amount and currency always come
 * from the booking row (the server-side pricing snapshot) — the browser never supplies them.
 */

/** A lapsed hold is marked EXPIRED the moment anyone looks at it (the cron job sweeps the rest). */
async function expireIfLapsed(bookingId: string, now: Date) {
  await prisma.booking.updateMany({ where: { id: bookingId, status: "PENDING", expiresAt: { lte: now } }, data: { status: "EXPIRED" } });
}

export async function getCheckoutBooking(guestId: string, reference: string, now = new Date()) {
  if (!isPlausibleReference(reference)) return null;
  const found = await prisma.booking.findFirst({ where: { reference, guestId }, select: { id: true } });
  if (!found) return null;
  await expireIfLapsed(found.id, now);
  return prisma.booking.findUnique({
    where: { id: found.id },
    include: {
      guest: { select: { name: true, email: true } },
      property: {
        select: {
          slug: true,
          title: true,
          type: true,
          isDemo: true,
          timezone: true,
          locality: true,
          adminArea: true,
          destination: { select: { name: true } },
          images: { orderBy: { position: "asc" }, take: 1, select: { url: true, alt: true } },
        },
      },
      payments: { select: { provider: true, status: true, failureCode: true } },
    },
  });
}
export type CheckoutBooking = NonNullable<Awaited<ReturnType<typeof getCheckoutBooking>>>;

export type PreparePaymentResult =
  | { ok: true; provider: "stripe"; clientSecret: string; publishableKey: string }
  | { ok: true; provider: "mock" }
  | { ok: false; state: "not_found" | "not_payable" | "processing" | "config"; error: string };

/**
 * Start (or resume) payment for a live hold. Idempotent: one Payment row per booking and
 * provider (DB-unique), and the PaymentIntent is created with a deterministic idempotency key, so
 * double clicks, retries and refreshes all resolve to the same intent.
 */
export async function preparePayment(guestId: string, reference: string, now = new Date()): Promise<PreparePaymentResult> {
  const booking = await getCheckoutBooking(guestId, reference, now);
  if (!booking) return { ok: false, state: "not_found", error: "Booking not found." };
  if (booking.status !== "PENDING" || !booking.expiresAt || booking.expiresAt <= now) {
    return { ok: false, state: "not_payable", error: "This booking can no longer be paid for." };
  }

  const active = getPaymentProvider();
  if (!active.ok) {
    log.error("payment.config_error", { reason: active.error });
    return { ok: false, state: "config", error: "Payments aren't available right now." };
  }
  const { provider, config } = active;

  let payment = await prisma.payment.findUnique({ where: { bookingId_provider: { bookingId: booking.id, provider: provider.name } } });
  if (!payment) {
    const { providerPaymentId } = await provider.createPayment({
      bookingId: booking.id,
      reference: booking.reference,
      amountCents: booking.totalCents,
      currency: booking.currency,
      idempotencyKey: `roavela:booking:${booking.id}:payment`,
    });
    try {
      payment = await prisma.payment.create({
        data: { bookingId: booking.id, provider: provider.name, providerPaymentId, amountCents: booking.totalCents, currency: booking.currency },
      });
      track({ name: "payment_started", properties: { bookingId: booking.id, provider: provider.name }, userId: guestId });
      log.info("payment.created", { reference: booking.reference, provider: provider.name, amountCents: booking.totalCents });
    } catch (e) {
      if (!isUniqueViolation(e)) throw e;
      payment = await prisma.payment.findUniqueOrThrow({ where: { bookingId_provider: { bookingId: booking.id, provider: provider.name } } });
    }
  }
  if (payment.status === "PROCESSING" || payment.status === "SUCCEEDED") {
    return { ok: false, state: "processing", error: "Your payment is being processed." };
  }

  if (config.provider === "mock") return { ok: true, provider: "mock" };
  const clientSecret = payment.providerPaymentId ? await provider.getClientSecret(payment.providerPaymentId) : null;
  if (!clientSecret) return { ok: false, state: "processing", error: "Your payment is being processed." };
  return { ok: true, provider: "stripe", clientSecret, publishableKey: config.publishableKey };
}

/**
 * Development only: simulate the provider reporting a payment outcome. It goes through exactly the
 * same event processing (and validation) as a verified Stripe webhook. Refused unless the mock
 * provider is active, and the mock provider itself is refused in production.
 */
export async function simulateMockPayment(guestId: string, reference: string, outcome: "succeeded" | "failed", now = new Date()) {
  const active = getPaymentProvider();
  if (!active.ok || active.provider.name !== "mock" || env().NODE_ENV === "production") {
    return { ok: false as const, error: "Simulated payments are only available in development without Stripe keys." };
  }
  const booking = await prisma.booking.findFirst({ where: { reference, guestId }, select: { id: true, reference: true } });
  if (!booking) return { ok: false as const, error: "Booking not found." };
  const payment = await prisma.payment.findUnique({ where: { bookingId_provider: { bookingId: booking.id, provider: "mock" } } });
  if (!payment?.providerPaymentId) return { ok: false as const, error: "Start the payment first." };

  const result = await processPaymentEvent(
    {
      provider: "mock",
      eventId: `mock_evt_${randomBytes(12).toString("hex")}`,
      eventType: outcome === "succeeded" ? "payment_intent.succeeded" : "payment_intent.payment_failed",
      kind: outcome,
      providerPaymentId: payment.providerPaymentId,
      amountCents: payment.amountCents,
      currency: payment.currency,
      reference: booking.reference,
      failureCode: outcome === "failed" ? "card_declined" : null,
    },
    now,
  );
  return { ok: true as const, outcome: result.outcome };
}

/**
 * Release lapsed checkout holds and stop their unpaid payments. Run by the cron route; holds are
 * also expired on read and before any overlapping insert, so correctness never depends on this job.
 */
export async function releaseExpiredHolds(now = new Date()) {
  const expired = await prisma.booking.updateMany({ where: { status: "PENDING", expiresAt: { lte: now } }, data: { status: "EXPIRED" } });

  const stale = await prisma.payment.findMany({
    where: { status: { in: ["REQUIRES_PAYMENT", "FAILED"] }, booking: { status: "EXPIRED" } },
    select: { id: true, provider: true, providerPaymentId: true },
    take: 100,
  });
  const active = getPaymentProvider();
  let cancelled = 0;
  for (const p of stale) {
    if (!active.ok || active.provider.name !== p.provider || !p.providerPaymentId) continue;
    try {
      await active.provider.cancelPayment(p.providerPaymentId);
      // Only unpaid rows change; a success that raced in is left for its webhook.
      const r = await prisma.payment.updateMany({ where: { id: p.id, status: { in: ["REQUIRES_PAYMENT", "FAILED"] } }, data: { status: "CANCELLED" } });
      cancelled += r.count;
    } catch (e) {
      log.warn("payment.cancel_failed", { paymentId: p.id, ...errorFields(e) });
    }
  }
  if (expired.count || cancelled) log.info("booking.holds_released", { expired: expired.count, paymentsCancelled: cancelled });
  return { expired: expired.count, paymentsCancelled: cancelled };
}

// ── Guest cancellation ────────────────────────────────────────────────────────

export type CancelResult = { ok: true; refundCents: number; status: "CANCELLED" | "REFUND_PENDING" } | { ok: false; error: string };

/** Preview what cancelling would refund, from the booking's own policy snapshot. */
export function cancellationPreview(
  b: { status: string; checkIn: Date; totalCents: number; accommodationCents: number; cleaningFeeCents: number; cancellationPolicy: "FLEXIBLE" | "MODERATE" | "STRICT" | null },
  timezone: string,
  now = new Date(),
) {
  if (b.status !== "CONFIRMED") return null;
  const today = todayInTimeZone(timezone, now);
  if (nightsBetween(today, b.checkIn) < 0) return null;
  return quoteCancellation(b.cancellationPolicy ?? "MODERATE", b, today);
}

export async function cancelBookingAsGuest(guestId: string, reference: string, now = new Date()): Promise<CancelResult> {
  if (!isPlausibleReference(reference)) return { ok: false, error: "Booking not found." };

  const outcome = await prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "Booking" WHERE "reference" = ${reference} AND "guestId" = ${guestId} FOR UPDATE`;
    if (rows.length === 0) return { ok: false as const, error: "Booking not found." };
    const booking = await tx.booking.findUniqueOrThrow({
      where: { id: rows[0]!.id },
      include: { property: { select: { title: true, timezone: true } }, payments: { where: { status: "SUCCEEDED" }, select: { id: true, amountCents: true } } },
    });
    if (booking.status !== "CONFIRMED") return { ok: false as const, error: "Only confirmed bookings can be cancelled." };
    const preview = cancellationPreview(booking, booking.property.timezone, now);
    if (!preview) return { ok: false as const, error: "This stay has already started, so it can't be cancelled online." };

    // A refund needs a captured payment to refund against (seeded demo bookings have none).
    const payment = booking.payments[0];
    const refundCents = payment ? Math.min(preview.refundCents, payment.amountCents) : 0;
    const status = bookingTransition(refundCents > 0 ? "cancel_with_refund" : "cancel_no_refund", booking.status) as "CANCELLED" | "REFUND_PENDING";
    await tx.booking.update({
      where: { id: booking.id },
      data: { status, cancelledAt: now, cancellationReason: "Cancelled by guest", refundDueCents: refundCents },
    });
    return { ok: true as const, booking, paymentId: payment?.id ?? null, refundCents, status };
  });
  if (!outcome.ok) return outcome;

  const { booking, paymentId, refundCents, status } = outcome;
  log.info("booking.cancelled", { reference: booking.reference, by: "guest", refundCents });
  track({ name: "booking_cancelled", properties: { bookingId: booking.id, by: "guest", refundCents }, userId: guestId });
  if (paymentId && refundCents > 0) await requestRefund({ paymentId, amountCents: refundCents, reason: "guest_cancellation", bookingId: booking.id });

  const guest = await prisma.user.findUnique({ where: { id: guestId }, select: { email: true } });
  if (guest) {
    await sendBookingEmail(
      "booking_cancelled",
      booking.reference,
      bookingCancelledEmail(
        guest.email,
        { reference: booking.reference, propertyTitle: booking.property.title, checkIn: booking.checkIn, checkOut: booking.checkOut, nights: booking.nights, totalCents: booking.totalCents, currency: booking.currency },
        refundCents,
      ),
    );
  }
  return { ok: true, refundCents, status };
}
