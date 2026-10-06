import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { bookingTransition } from "@/lib/booking-lifecycle";
import { ADMIN_PAGE_SIZE } from "@/lib/admin/query";
import { maxRefundableCents, outstandingPolicyRefundCents, REFUNDABLE_PAYMENT_STATUSES } from "@/lib/admin/refunds";
import { isPlausibleReference } from "@/lib/validation/booking";
import { parseMoneyToCents } from "@/lib/validation/host";
import { prisma } from "@/server/db";
import { bookingCancelledByRoavelaEmail, refundRequestedEmail, sendAdminEmail } from "@/server/emails/admin-emails";
import { executeRefund } from "@/server/payments/refunds";
import { track } from "@/server/providers/analytics";
import { cancellationPreview } from "@/server/services/checkout";
import { cleanText, FORBIDDEN, fail, MIN_REASON, ok, permitted, recordAdminAction, STALE, type AdminActor, type AdminResult } from "./common";

/**
 * Admin refund operations (Stripe TEST MODE only — the payment config refuses live keys).
 *
 * The flow is preview → confirmation → server execution → provider result → database. The
 * browser only ever sends: which booking, a mode, an amount the server re-validates, a reason and
 * a one-time request key. The maximum is recomputed on the server under a row lock, the request key
 * makes repeats idempotent, and booking/payment state only changes when the provider reports it.
 */
export type RefundMode = "policy" | "custom";

const REQUEST_KEY = /^[A-Za-z0-9-]{16,64}$/;

async function loadRefundContext(reference: string) {
  if (!isPlausibleReference(reference)) return null;
  return prisma.booking.findUnique({
    where: { reference },
    select: {
      id: true,
      reference: true,
      status: true,
      refundDueCents: true,
      currency: true,
      guest: { select: { email: true } },
      payments: { select: { id: true, status: true, amountCents: true, refundedCents: true, refunds: { select: { status: true, amountCents: true } } } },
    },
  });
}

export async function executeAdminRefund(
  actor: AdminActor,
  input: { reference: string; mode: string; amount: unknown; reason: unknown; requestKey: unknown },
): Promise<AdminResult<{ amountCents: number; status: string; duplicate: boolean }>> {
  if (!permitted(actor, "admin:refunds:manage")) return FORBIDDEN();
  const reason = cleanText(input.reason, 1000);
  if (reason.length < MIN_REASON) return fail("invalid", "Record why this refund is being made (at least 5 characters).");
  if (typeof input.requestKey !== "string" || !REQUEST_KEY.test(input.requestKey)) return fail("invalid", "This refund form has expired. Reload the page and try again.");
  if (input.mode !== "policy" && input.mode !== "custom") return fail("invalid", "Choose a refund type.");

  const booking = await loadRefundContext(input.reference);
  if (!booking) return fail("not_found", "Booking not found.");
  const payment = booking.payments.find((p) => REFUNDABLE_PAYMENT_STATUSES.includes(p.status));
  if (!payment) return fail("invalid", "This booking has no captured payment to refund.");

  // The amount is decided (policy) or validated (custom) here — never trusted from the browser.
  let amountCents: number;
  if (input.mode === "policy") {
    amountCents = booking.status === "REFUND_PENDING" ? outstandingPolicyRefundCents(booking.refundDueCents, payment, payment.refunds) : 0;
    if (amountCents <= 0) return fail("invalid", "No policy refund is outstanding on this booking.");
  } else {
    const parsed = typeof input.amount === "string" ? parseMoneyToCents(input.amount) : null;
    if (parsed === null) return fail("invalid", "Enter the refund amount in dollars, e.g. 120 or 120.50.");
    amountCents = parsed;
    if (amountCents > maxRefundableCents(payment, payment.refunds)) return fail("invalid", "That's more than can be refunded on this payment.");
  }

  const result = await executeRefund({
    paymentId: payment.id,
    amountCents,
    reason: "admin_refund",
    idempotencyKey: `admin:${input.requestKey}`,
    requestedById: actor.id,
    // Policy refunds are re-capped under the payment lock at what is still owed (no double refund).
    ...(input.mode === "policy" ? { refundDueCents: booking.refundDueCents ?? 0 } : {}),
    adminAction: { adminId: actor.id, action: "refund.executed", targetType: "Booking", targetId: booking.id, reason, metadata: { mode: input.mode, paymentId: payment.id } },
  });
  if (!result.ok) return fail(result.code === "not_found" ? "not_found" : result.code === "provider" ? "provider" : "invalid", result.message);
  if (!result.duplicate) {
    track({ name: "refund_reviewed", properties: { bookingId: booking.id, decision: "executed", amountCents } });
    await sendAdminEmail("refund_requested", booking.id, refundRequestedEmail(booking.guest.email, booking.reference, amountCents, booking.currency));
  }
  return ok({ amountCents: result.amountCents, status: result.status, duplicate: result.duplicate });
}

/** Decline a refund request: an audited decision, no money moves and no booking state changes. */
export async function declineRefund(actor: AdminActor, input: { reference: string; reason: unknown }): Promise<AdminResult> {
  if (!permitted(actor, "admin:refunds:manage")) return FORBIDDEN();
  const reason = cleanText(input.reason, 1000);
  if (reason.length < MIN_REASON) return fail("invalid", "Record why the refund is declined (at least 5 characters).");
  const booking = await loadRefundContext(input.reference);
  if (!booking) return fail("not_found", "Booking not found.");
  if (booking.status === "REFUND_PENDING") {
    return fail("invalid", "A refund is owed under this booking's cancellation policy, so it can't be declined. Execute the outstanding refund instead.");
  }
  await prisma.adminAction.create({ data: { adminId: actor.id, action: "refund.declined", targetType: "Booking", targetId: booking.id, reason } });
  track({ name: "refund_reviewed", properties: { bookingId: booking.id, decision: "declined", amountCents: 0 } });
  return ok(undefined);
}

/**
 * Admin cancellation of a CONFIRMED booking through the normal lifecycle (never arbitrary state):
 * CONFIRMED → REFUND_PENDING (refund due) or CANCELLED (none). The refund then runs through the
 * same idempotent pipeline. "full" refunds everything paid (e.g. Roavela cancelled the stay);
 * "policy" applies the booking's own cancellation-policy snapshot.
 */
export async function cancelBookingAsAdmin(
  actor: AdminActor,
  input: { reference: string; refundMode: unknown; reason: unknown; requestKey: unknown; expectedUpdatedAt: Date | null },
  now = new Date(),
): Promise<AdminResult<{ status: string; refundCents: number; refundError?: string }>> {
  if (!permitted(actor, "admin:bookings:manage") || !permitted(actor, "admin:refunds:manage")) return FORBIDDEN();
  const reason = cleanText(input.reason, 1000);
  if (reason.length < MIN_REASON) return fail("invalid", "Record why Roavela is cancelling this booking (at least 5 characters).");
  if (input.refundMode !== "full" && input.refundMode !== "policy" && input.refundMode !== "none") return fail("invalid", "Choose how much to refund.");
  if (typeof input.requestKey !== "string" || !REQUEST_KEY.test(input.requestKey)) return fail("invalid", "This form has expired. Reload the page and try again.");
  if (!isPlausibleReference(input.reference)) return fail("not_found", "Booking not found.");
  const refundMode = input.refundMode;

  type Outcome = { ok: false; error: AdminResult<never> } | { ok: true; bookingId: string; status: "CANCELLED" | "REFUND_PENDING"; refundCents: number; paymentId: string | null; email: string; title: string; currency: string };
  const outcome: Outcome = await prisma.$transaction(async (tx: Prisma.TransactionClient): Promise<Outcome> => {
    const rows = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "Booking" WHERE "reference" = ${input.reference} FOR UPDATE`;
    if (rows.length === 0) return { ok: false, error: fail("not_found", "Booking not found.") };
    const b = await tx.booking.findUniqueOrThrow({
      where: { id: rows[0]!.id },
      include: {
        property: { select: { title: true, timezone: true } },
        guest: { select: { email: true } },
        payments: { select: { id: true, status: true, amountCents: true, refundedCents: true, refunds: { select: { status: true, amountCents: true } } } },
      },
    });
    if (!input.expectedUpdatedAt || b.updatedAt.getTime() !== input.expectedUpdatedAt.getTime()) return { ok: false, error: STALE("booking") };
    if (b.status !== "CONFIRMED") return { ok: false, error: fail("invalid_transition", "Only confirmed bookings can be cancelled.") };

    const payment = b.payments.find((p) => REFUNDABLE_PAYMENT_STATUSES.includes(p.status)) ?? null;
    const max = payment ? maxRefundableCents(payment, payment.refunds) : 0;
    const wanted = refundMode === "full" ? max : refundMode === "policy" ? (cancellationPreview(b, b.property.timezone, now)?.refundCents ?? 0) : 0;
    const refundCents = Math.min(wanted, max);
    const status = bookingTransition(refundCents > 0 ? "cancel_with_refund" : "cancel_no_refund", b.status) as "CANCELLED" | "REFUND_PENDING";
    await tx.booking.update({ where: { id: b.id }, data: { status, cancelledAt: now, cancellationReason: `Cancelled by Roavela: ${reason}`.slice(0, 500), refundDueCents: refundCents } });
    await recordAdminAction(tx, { adminId: actor.id, action: "booking.cancelled", targetType: "Booking", targetId: b.id, reason, metadata: { from: "CONFIRMED", to: status, refundMode, refundDueCents: refundCents } });
    return { ok: true, bookingId: b.id, status, refundCents, paymentId: payment?.id ?? null, email: b.guest.email, title: b.property.title, currency: b.currency };
  });
  if (!outcome.ok) return outcome.error;

  track({ name: "booking_cancelled", properties: { bookingId: outcome.bookingId, by: "admin", refundCents: outcome.refundCents } });
  let refundError: string | undefined;
  if (outcome.paymentId && outcome.refundCents > 0) {
    const r = await executeRefund({
      paymentId: outcome.paymentId,
      amountCents: outcome.refundCents,
      reason: "admin_cancellation",
      idempotencyKey: `admin-cancel:${input.requestKey}`,
      requestedById: actor.id,
      refundDueCents: outcome.refundCents,
    });
    // The cancellation stands; a failed refund leaves the booking REFUND_PENDING in the refund queue.
    if (!r.ok) refundError = r.message;
  }
  await sendAdminEmail("booking_cancelled_by_roavela", outcome.bookingId, bookingCancelledByRoavelaEmail(outcome.email, input.reference, outcome.title, outcome.refundCents, outcome.currency));
  return ok({ status: outcome.status, refundCents: outcome.refundCents, refundError });
}

// ── Queue ─────────────────────────────────────────────────────────────────────

export const REFUND_VIEWS = ["attention", "ledger"] as const;
export type RefundView = (typeof REFUND_VIEWS)[number];

/** Bookings needing refund action: policy refunds not yet confirmed, plus failed refund requests. */
export async function listRefundAttention(page: number) {
  const where: Prisma.BookingWhereInput = { OR: [{ status: "REFUND_PENDING" }, { refunds: { some: { status: { in: ["FAILED", "PENDING"] } } } }] };
  const [total, rows] = await Promise.all([
    prisma.booking.count({ where }),
    prisma.booking.findMany({
      where,
      orderBy: [{ cancelledAt: "asc" }, { id: "asc" }],
      skip: (page - 1) * ADMIN_PAGE_SIZE,
      take: ADMIN_PAGE_SIZE,
      select: {
        id: true,
        reference: true,
        status: true,
        currency: true,
        totalCents: true,
        refundDueCents: true,
        cancelledAt: true,
        isDemo: true,
        property: { select: { title: true } },
        guest: { select: { name: true } },
        payments: { select: { id: true, status: true, amountCents: true, refundedCents: true, refunds: { select: { status: true, amountCents: true } } } },
        refunds: { orderBy: { createdAt: "desc" }, take: 1, select: { status: true, failureCode: true, createdAt: true } },
      },
    }),
  ]);
  return {
    total,
    rows: rows.map((b) => {
      const payment = b.payments.find((p) => REFUNDABLE_PAYMENT_STATUSES.includes(p.status));
      return { ...b, outstandingCents: payment && b.status === "REFUND_PENDING" ? outstandingPolicyRefundCents(b.refundDueCents, payment, payment.refunds) : 0, latestRefund: b.refunds[0] ?? null };
    }),
  };
}

export async function listRefundLedger(page: number) {
  const [total, rows] = await Promise.all([
    prisma.refund.count(),
    prisma.refund.findMany({
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      skip: (page - 1) * ADMIN_PAGE_SIZE,
      take: ADMIN_PAGE_SIZE,
      select: { id: true, amountCents: true, currency: true, status: true, reason: true, providerRefundId: true, failureCode: true, createdAt: true, confirmedAt: true, booking: { select: { reference: true } }, requestedBy: { select: { name: true } } },
    }),
  ]);
  return { total, rows };
}
