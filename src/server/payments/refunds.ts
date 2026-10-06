import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import type { RefundStatus } from "@/generated/prisma/enums";
import { checkRefundAmount, maxRefundableCents, outstandingPolicyRefundCents } from "@/lib/admin/refunds";
import { prisma } from "@/server/db";
import { isUniqueViolation } from "@/server/db-errors";
import { errorFields, log } from "@/server/log";
import { track } from "@/server/providers/analytics";
import { getPaymentProvider, type ProviderRefund } from "./provider";

/**
 * THE single path that sends money back to a guest. Guest cancellations, late-payment refunds and
 * admin refunds all come through here, so they share one set of guarantees:
 *
 *  1. Idempotent. Every request carries a key that is UNIQUE in the Refund ledger and is also sent
 *     to the provider. A repeated click, retry or replay returns the original refund — never a second.
 *  2. Never over-refunds. Under a row lock on the Payment, the amount is checked against
 *     amount paid − (provider-confirmed refunds or our confirmed ledger) − refunds still in flight.
 *  3. Never fakes success. The ledger row starts PENDING and only takes the provider's reported
 *     status. Booking/payment totals move only when the provider reports the refund (charge.refunded).
 *  4. Test mode only. The provider comes from the payment config, which refuses live Stripe keys.
 */
export type RefundReason = "guest_cancellation" | "late_payment" | "admin_cancellation" | "admin_refund";

export interface RefundRequest {
  paymentId: string;
  amountCents: number;
  reason: RefundReason;
  idempotencyKey: string;
  /** Admin who executed it (null for automatic refunds). */
  requestedById?: string | null;
  /**
   * For refunds owed under a cancellation (REFUND_PENDING): the total refund due. The cap is then
   * re-derived UNDER THE LOCK as due − refunds already made or in flight, so two concurrent requests
   * for "the outstanding refund" can never both succeed.
   */
  refundDueCents?: number;
  /** Written in the same transaction as the ledger row, so the decision and the refund can't diverge. */
  adminAction?: { adminId: string; action: string; targetType: string; targetId: string; reason?: string | null; metadata?: Prisma.InputJsonValue };
}

export type RefundResult =
  | { ok: true; refundId: string; status: RefundStatus; amountCents: number; duplicate: boolean }
  | { ok: false; code: "not_found" | "invalid" | "provider"; message: string };

export const REFUND_FAILED_MESSAGE = "Refund could not be completed. No booking or payment status was changed.";

const STATUS: Record<ProviderRefund["status"], RefundStatus> = { pending: "PENDING", succeeded: "SUCCEEDED", failed: "FAILED", canceled: "CANCELLED" };

export async function executeRefund(req: RefundRequest): Promise<RefundResult> {
  if (!/^[\w:.-]{8,200}$/.test(req.idempotencyKey)) return { ok: false, code: "invalid", message: "Invalid refund request." };

  const active = getPaymentProvider();
  if (!active.ok) {
    log.error("refund.provider_unavailable", { paymentId: req.paymentId, reason: active.error });
    return { ok: false, code: "provider", message: `${REFUND_FAILED_MESSAGE} Payments aren't configured correctly on this server.` };
  }

  // Phase 1 — reserve the refund in the ledger (or find the original request for this key).
  type Reserved = { kind: "duplicate"; row: { id: string; status: RefundStatus; amountCents: number } } | { kind: "new"; id: string; providerPaymentId: string; provider: string; currency: string } | { kind: "error"; code: "not_found" | "invalid" | "provider"; message: string };
  let reserved: Reserved;
  try {
    reserved = await prisma.$transaction(async (tx): Promise<Reserved> => {
      const locked = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "Payment" WHERE "id" = ${req.paymentId} FOR UPDATE`;
      if (locked.length === 0) return { kind: "error", code: "not_found", message: "Payment not found." };

      const existing = await tx.refund.findUnique({ where: { idempotencyKey: req.idempotencyKey }, select: { id: true, status: true, amountCents: true, paymentId: true } });
      if (existing) {
        if (existing.paymentId !== req.paymentId) return { kind: "error", code: "invalid", message: "Invalid refund request." };
        return { kind: "duplicate", row: existing };
      }

      const payment = await tx.payment.findUniqueOrThrow({
        where: { id: req.paymentId },
        select: { id: true, bookingId: true, provider: true, providerPaymentId: true, status: true, amountCents: true, refundedCents: true, currency: true, refunds: { select: { status: true, amountCents: true } } },
      });
      if (!payment.providerPaymentId) return { kind: "error", code: "invalid", message: "This payment has no provider record to refund." };
      if (payment.provider !== active.provider.name) {
        return { kind: "error", code: "provider", message: `${REFUND_FAILED_MESSAGE} This payment was taken with a different payment provider.` };
      }
      const cap = req.refundDueCents !== undefined ? outstandingPolicyRefundCents(req.refundDueCents, payment, payment.refunds) : maxRefundableCents(payment, payment.refunds);
      const check = checkRefundAmount(req.amountCents, cap);
      if (!check.ok) return { kind: "error", code: "invalid", message: check.error };

      const row = await tx.refund.create({
        data: {
          paymentId: payment.id,
          bookingId: payment.bookingId,
          amountCents: req.amountCents,
          currency: payment.currency,
          reason: req.reason,
          idempotencyKey: req.idempotencyKey,
          requestedById: req.requestedById ?? null,
        },
        select: { id: true },
      });
      if (req.adminAction) {
        await tx.adminAction.create({ data: { ...req.adminAction, reason: req.adminAction.reason || null, metadata: { ...(req.adminAction.metadata as object | undefined), refundId: row.id, amountCents: req.amountCents } } });
      }
      return { kind: "new", id: row.id, providerPaymentId: payment.providerPaymentId, provider: payment.provider, currency: payment.currency };
    });
  } catch (e) {
    if (isUniqueViolation(e)) {
      // A concurrent request with the same key won the race: report its refund.
      const row = await prisma.refund.findUnique({ where: { idempotencyKey: req.idempotencyKey }, select: { id: true, status: true, amountCents: true } });
      if (row) return { ok: true, refundId: row.id, status: row.status, amountCents: row.amountCents, duplicate: true };
    }
    throw e;
  }

  if (reserved.kind === "error") return { ok: false, code: reserved.code, message: reserved.message };
  if (reserved.kind === "duplicate") return { ok: true, refundId: reserved.row.id, status: reserved.row.status, amountCents: reserved.row.amountCents, duplicate: true };

  // Phase 2 — ask the provider (outside any transaction: never hold a lock across a network call).
  let providerRefund: ProviderRefund;
  try {
    providerRefund = await active.provider.refund({ providerPaymentId: reserved.providerPaymentId, amountCents: req.amountCents, idempotencyKey: `roavela:refund:${req.idempotencyKey}` });
  } catch (e) {
    log.error("refund.request_failed", { refundId: reserved.id, paymentId: req.paymentId, reason: req.reason, ...errorFields(e) });
    await prisma.refund.update({ where: { id: reserved.id }, data: { status: "FAILED", failureCode: "provider_error" } });
    return { ok: false, code: "provider", message: REFUND_FAILED_MESSAGE };
  }

  const status = STATUS[providerRefund.status];
  await prisma.refund.update({
    where: { id: reserved.id },
    data: {
      providerRefundId: providerRefund.refundId,
      status,
      confirmedAt: status === "SUCCEEDED" ? new Date() : null,
      failureCode: providerRefund.failureReason?.slice(0, 64) ?? null,
    },
  });
  log.info("refund.requested", { refundId: reserved.id, paymentId: req.paymentId, amountCents: req.amountCents, reason: req.reason, providerStatus: providerRefund.status });

  if (active.provider.name === "mock" && status === "SUCCEEDED") {
    // The development provider reports the refund through the same event pipeline as Stripe's
    // charge.refunded webhook (cumulative amount), so booking state follows identical rules.
    const { processPaymentEvent } = await import("./events");
    const payment = await prisma.payment.findUniqueOrThrow({ where: { id: req.paymentId }, select: { amountCents: true, refundedCents: true } });
    await processPaymentEvent({
      provider: "mock",
      eventId: `mock_evt_${providerRefund.refundId}`,
      eventType: "charge.refunded",
      kind: "refunded",
      providerPaymentId: reserved.providerPaymentId,
      currency: reserved.currency,
      refundedCents: Math.min(payment.amountCents, payment.refundedCents + req.amountCents),
    });
  }
  return status === "FAILED" || status === "CANCELLED"
    ? { ok: false, code: "provider", message: REFUND_FAILED_MESSAGE }
    : { ok: true, refundId: reserved.id, status, amountCents: req.amountCents, duplicate: false };
}

/**
 * Automatic refunds (guest cancellation, late payment). Best effort: on failure the booking stays
 * REFUND_PENDING and the failed ledger row appears in the admin refund queue for a retry.
 */
export async function requestRefund({ paymentId, amountCents, reason, bookingId }: { paymentId: string; amountCents: number; reason: "guest_cancellation" | "late_payment"; bookingId: string }) {
  if (amountCents <= 0) return;
  track({ name: "refund_requested", properties: { bookingId, amountCents, reason } });
  try {
    const result = await executeRefund({
      paymentId,
      amountCents,
      reason,
      idempotencyKey: `roavela:payment:${paymentId}:refund:${reason}`,
      // A guest cancellation refunds exactly the policy amount due; a late payment refunds it all.
      ...(reason === "guest_cancellation" ? { refundDueCents: amountCents } : {}),
    });
    if (!result.ok) log.error("refund.automatic_failed", { paymentId, reason, code: result.code });
  } catch (e) {
    log.error("refund.automatic_failed", { paymentId, reason, ...errorFields(e) });
  }
}
