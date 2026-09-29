import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import type { BookingStatus, PaymentStatus } from "@/generated/prisma/enums";
import { bookingTransition } from "@/lib/booking-lifecycle";
import { prisma } from "@/server/db";
import { isUniqueViolation } from "@/server/db-errors";
import { bookingConfirmedEmail, hostNewBookingEmail, paymentFailedEmail, sendBookingEmail } from "@/server/emails/booking-emails";
import { errorFields, log } from "@/server/log";
import { track } from "@/server/providers/analytics";
import { firstName } from "@/lib/validation/booking";
import { getPaymentProvider } from "./provider";

/**
 * THE place where payments change booking state. Verified Stripe webhooks and the development
 * mock provider both arrive here as a normalised event, so both follow identical rules:
 *
 *  - Every event is recorded once (WebhookEvent, unique per provider + event id); duplicates are
 *    acknowledged and ignored. No payloads are stored — only ids, type and outcome.
 *  - The Payment and Booking rows are locked (SELECT … FOR UPDATE) for the whole transaction, so
 *    concurrent or out-of-order deliveries serialise and each state change happens exactly once.
 *  - A success must match OUR records: the payment id, our booking reference, the exact amount
 *    and the currency. Anything else is rejected and never confirms a booking.
 *  - Side effects (emails, analytics, refund requests) run only after the transaction commits,
 *    and only for state changes this event actually caused.
 */
export type PaymentEventKind = "succeeded" | "failed" | "processing" | "canceled" | "refunded" | "ignored";

export interface PaymentEvent {
  provider: "stripe" | "mock";
  eventId: string;
  eventType: string;
  kind: PaymentEventKind;
  providerPaymentId: string | null;
  /** For "succeeded": the amount actually received, in minor units. */
  amountCents?: number;
  currency?: string;
  /** Our booking reference from the payment's metadata. */
  reference?: string | null;
  failureCode?: string | null;
  /** For "refunded": the CUMULATIVE amount refunded on this payment. */
  refundedCents?: number;
}

export type ProcessOutcome = "processed" | "duplicate" | "ignored" | "rejected";

export interface ProcessResult {
  outcome: ProcessOutcome;
  message: string;
}

type Effect = () => Promise<void>;

const UNPAID: PaymentStatus[] = ["REQUIRES_PAYMENT", "PROCESSING", "FAILED"];
const REFUNDED: PaymentStatus[] = ["REFUNDED", "PARTIALLY_REFUNDED"];

class Rejection extends Error {}

export async function processPaymentEvent(ev: PaymentEvent, now = new Date()): Promise<ProcessResult> {
  const key = { provider_externalEventId: { provider: ev.provider, externalEventId: ev.eventId } };
  const seen = await prisma.webhookEvent.findUnique({ where: key, select: { status: true } });
  // FAILED events may be retried (e.g. the database was briefly unavailable); anything else is done.
  if (seen && seen.status !== "FAILED") return { outcome: "duplicate", message: "Event already processed" };

  const record = (tx: Prisma.TransactionClient | typeof prisma, status: "PROCESSED" | "IGNORED" | "FAILED", message: string, paymentId: string | null) =>
    tx.webhookEvent.upsert({
      where: key,
      create: { provider: ev.provider, externalEventId: ev.eventId, eventType: ev.eventType, status, message, paymentId, processedAt: now },
      update: { status, message, paymentId, processedAt: now },
    });

  if (ev.kind === "ignored" || !ev.providerPaymentId) {
    await record(prisma, "IGNORED", ev.providerPaymentId ? "Event type not handled" : "No payment id on event", null);
    return { outcome: "ignored", message: "Event type not handled" };
  }
  const providerPaymentId = ev.providerPaymentId;

  const effects: Effect[] = [];
  let result: ProcessResult;
  try {
    result = await prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<{ id: string; bookingId: string }[]>`
        SELECT "id", "bookingId" FROM "Payment" WHERE "provider" = ${ev.provider} AND "providerPaymentId" = ${providerPaymentId} FOR UPDATE`;
      if (locked.length === 0) {
        // Not ours (another integration on the same Stripe account) or not yet recorded.
        await record(tx, "IGNORED", "Unknown payment", null);
        return { outcome: "ignored" as const, message: "Unknown payment" };
      }
      const [{ id: paymentId, bookingId }] = locked as [{ id: string; bookingId: string }];
      await tx.$queryRaw`SELECT "id" FROM "Booking" WHERE "id" = ${bookingId} FOR UPDATE`;

      // Re-check under the lock: a concurrent delivery of the same event may have just committed.
      const again = await tx.webhookEvent.findUnique({ where: key, select: { status: true } });
      if (again && again.status !== "FAILED") return { outcome: "duplicate" as const, message: "Event already processed" };

      const payment = await tx.payment.findUniqueOrThrow({
        where: { id: paymentId },
        include: {
          booking: {
            include: {
              guest: { select: { id: true, email: true, name: true } },
              property: { select: { id: true, title: true, host: { select: { user: { select: { email: true } } } } } },
            },
          },
        },
      });
      const booking = payment.booking;

      try {
        const message = await apply(tx, ev, payment, booking, now, effects);
        await record(tx, "PROCESSED", message, paymentId);
        return { outcome: "processed" as const, message };
      } catch (e) {
        if (!(e instanceof Rejection)) throw e;
        log.error("payment.event_rejected", { provider: ev.provider, eventId: ev.eventId, reference: booking.reference, reason: e.message });
        await record(tx, "FAILED", e.message, paymentId);
        return { outcome: "rejected" as const, message: e.message };
      }
    });
  } catch (e) {
    if (isUniqueViolation(e)) return { outcome: "duplicate", message: "Event already processed" };
    log.error("payment.event_error", { provider: ev.provider, eventId: ev.eventId, ...errorFields(e) });
    await record(prisma, "FAILED", "Processing error", null).catch(() => {});
    throw e;
  }

  for (const effect of effects) {
    await effect().catch((e) => log.error("payment.effect_failed", { eventId: ev.eventId, ...errorFields(e) }));
  }
  return result;
}

type LoadedPayment = Prisma.PaymentGetPayload<{
  include: {
    booking: {
      include: {
        guest: { select: { id: true; email: true; name: true } };
        property: { select: { id: true; title: true; host: { select: { user: { select: { email: true } } } } } };
      };
    };
  };
}>;

async function apply(tx: Prisma.TransactionClient, ev: PaymentEvent, payment: LoadedPayment, booking: LoadedPayment["booking"], now: Date, effects: Effect[]): Promise<string> {
  const ref = booking.reference;
  const emailData = { reference: ref, propertyTitle: booking.property.title, checkIn: booking.checkIn, checkOut: booking.checkOut, nights: booking.nights, totalCents: booking.totalCents, currency: booking.currency };

  // Every event must agree with our records about which booking and currency this is.
  if (ev.reference !== undefined && ev.reference !== null && ev.reference !== ref) throw new Rejection("Booking reference mismatch");
  if (ev.provider === "stripe" && !ev.reference && ev.kind === "succeeded") throw new Rejection("Missing booking reference");
  if (ev.currency !== undefined && ev.currency.toUpperCase() !== payment.currency.toUpperCase()) throw new Rejection("Currency mismatch");

  switch (ev.kind) {
    case "succeeded": {
      if (ev.amountCents !== payment.amountCents || payment.amountCents !== booking.totalCents) throw new Rejection("Amount mismatch");
      if (!REFUNDED.includes(payment.status)) {
        await tx.payment.update({ where: { id: payment.id }, data: { status: "SUCCEEDED", failureCode: null } });
      }
      if (booking.status === "CONFIRMED") return "Payment already applied";

      const target = bookingTransition("payment_confirmed", booking.status);
      if (!target) {
        log.warn("payment.succeeded_for_closed_booking", { reference: ref, status: booking.status });
        return `Payment recorded; booking is ${booking.status}`;
      }
      if (booking.status === "EXPIRED" && !(await datesStillFree(tx, booking))) {
        // Paid after the hold lapsed and someone else has the dates: never double-book — refund.
        effects.push(() => requestRefund({ paymentId: payment.id, amountCents: payment.amountCents, reason: "late_payment", bookingId: booking.id }));
        log.warn("payment.late_payment_refund", { reference: ref });
        return "Late payment for unavailable dates; refund requested";
      }
      // The exclusion constraint is the final guard for the EXPIRED → CONFIRMED case.
      await tx.booking.update({ where: { id: booking.id }, data: { status: target, confirmedAt: now } });

      const guestsCount = booking.adults + booking.children;
      effects.push(async () => {
        track({ name: "payment_succeeded", properties: { bookingId: booking.id, provider: ev.provider, amountCents: payment.amountCents, currency: payment.currency }, userId: booking.guestId });
        track({ name: "booking_confirmed", properties: { bookingId: booking.id, propertyId: booking.propertyId }, userId: booking.guestId });
        log.info("booking.confirmed", { reference: ref, provider: ev.provider, amountCents: payment.amountCents });
        await sendBookingEmail("booking_confirmed", ref, bookingConfirmedEmail(booking.guest.email, emailData));
        await sendBookingEmail(
          "host_new_booking",
          ref,
          hostNewBookingEmail(booking.property.host.user.email, { ...emailData, hostPayoutCents: booking.hostPayoutCents, guestFirstName: firstName(booking.guest.name), guests: guestsCount }),
        );
      });
      return `Booking ${booking.status === "EXPIRED" ? "confirmed after hold lapsed" : "confirmed"}`;
    }

    case "failed": {
      if (!UNPAID.includes(payment.status)) return `Ignored: payment already ${payment.status}`; // out of order
      await tx.payment.update({ where: { id: payment.id }, data: { status: "FAILED", failureCode: ev.failureCode?.slice(0, 64) ?? "unknown" } });
      // The booking is NOT confirmed. It stays PENDING (payable) until its hold expires.
      effects.push(async () => {
        track({ name: "payment_failed", properties: { bookingId: booking.id, provider: ev.provider, failureCode: ev.failureCode ?? undefined }, userId: booking.guestId });
        log.info("payment.failed", { reference: ref, failureCode: ev.failureCode ?? "unknown" });
        if (booking.status === "PENDING") await sendBookingEmail("payment_failed", ref, paymentFailedEmail(booking.guest.email, emailData, booking.expiresAt));
      });
      return "Payment failed; booking not confirmed";
    }

    case "processing": {
      if (!["REQUIRES_PAYMENT", "FAILED"].includes(payment.status)) return `Ignored: payment already ${payment.status}`;
      await tx.payment.update({ where: { id: payment.id }, data: { status: "PROCESSING" } });
      return "Payment processing";
    }

    case "canceled": {
      if (!UNPAID.includes(payment.status)) return `Ignored: payment already ${payment.status}`;
      await tx.payment.update({ where: { id: payment.id }, data: { status: "CANCELLED" } });
      return "Payment cancelled";
    }

    case "refunded": {
      const cumulative = ev.refundedCents ?? 0;
      if (!Number.isInteger(cumulative) || cumulative < 0 || cumulative > payment.amountCents) throw new Rejection("Refund amount out of range");
      const refundedCents = Math.max(payment.refundedCents, cumulative); // tolerate out-of-order refund events
      await tx.payment.update({
        where: { id: payment.id },
        data: { refundedCents, status: refundedCents >= payment.amountCents ? "REFUNDED" : refundedCents > 0 ? "PARTIALLY_REFUNDED" : payment.status },
      });
      if (booking.status === "REFUND_PENDING" && refundedCents >= (booking.refundDueCents ?? 0)) {
        const target = bookingTransition("refund_confirmed", booking.status) as BookingStatus;
        await tx.booking.update({ where: { id: booking.id }, data: { status: target } });
        effects.push(async () => log.info("booking.refunded", { reference: ref, refundedCents }));
        return "Refund completed";
      }
      return "Refund recorded";
    }
  }
  return "No change";
}

async function datesStillFree(tx: Prisma.TransactionClient, b: { id: string; propertyId: string; checkIn: Date; checkOut: Date }) {
  const overlap = { checkIn: { lt: b.checkOut }, checkOut: { gt: b.checkIn } };
  const [bookings, blocks] = await Promise.all([
    tx.booking.count({ where: { propertyId: b.propertyId, id: { not: b.id }, status: { in: ["PENDING", "CONFIRMED"] }, ...overlap } }),
    tx.blockedDate.count({ where: { propertyId: b.propertyId, startDate: { lt: b.checkOut }, endDate: { gt: b.checkIn } } }),
  ]);
  return bookings === 0 && blocks === 0;
}

/**
 * Ask the payment provider to refund. The refund is only recorded as complete when the provider
 * reports it (Stripe: charge.refunded webhook; mock: an equivalent synthetic event). If the request
 * fails the booking simply stays REFUND_PENDING and the failure is logged — never faked.
 */
export async function requestRefund({ paymentId, amountCents, reason, bookingId }: { paymentId: string; amountCents: number; reason: "guest_cancellation" | "late_payment"; bookingId: string }) {
  const payment = await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });
  if (!payment.providerPaymentId || amountCents <= 0) return;
  const active = getPaymentProvider();
  if (!active.ok || active.provider.name !== payment.provider) {
    log.error("refund.provider_unavailable", { paymentId, provider: payment.provider });
    return;
  }
  track({ name: "refund_requested", properties: { bookingId, amountCents, reason } });
  try {
    const { refundId } = await active.provider.refund({
      providerPaymentId: payment.providerPaymentId,
      amountCents,
      idempotencyKey: `roavela:payment:${payment.id}:refund:${reason}`,
    });
    log.info("refund.requested", { paymentId, amountCents, reason });
    if (active.provider.name === "mock") {
      await processPaymentEvent({
        provider: "mock",
        eventId: `mock_evt_${refundId}`,
        eventType: "charge.refunded",
        kind: "refunded",
        providerPaymentId: payment.providerPaymentId,
        currency: payment.currency,
        refundedCents: Math.min(payment.amountCents, payment.refundedCents + amountCents),
      });
    }
  } catch (e) {
    log.error("refund.request_failed", { paymentId, reason, ...errorFields(e) });
  }
}
