import type { PaymentStatus, RefundStatus } from "@/generated/prisma/enums";
import type { Cents } from "@/lib/money";

/**
 * Refund arithmetic — integer minor units only. Pure so the limits are unit-testable.
 *
 * What is already "committed" against a payment is deliberately conservative: the provider's own
 * cumulative refunded amount (or our confirmed ledger, if larger) PLUS every refund still in flight.
 * Counting an in-flight refund twice can only ever under-refund; it can never over-refund.
 */
export const REFUNDABLE_PAYMENT_STATUSES: readonly PaymentStatus[] = ["SUCCEEDED", "PARTIALLY_REFUNDED"];

export interface RefundablePayment {
  status: PaymentStatus;
  amountCents: Cents;
  refundedCents: Cents;
}

export interface LedgerRefund {
  status: RefundStatus;
  amountCents: Cents;
}

export function committedRefundCents(payment: RefundablePayment, ledger: readonly LedgerRefund[]): Cents {
  const sum = (s: RefundStatus) => ledger.filter((r) => r.status === s).reduce((t, r) => t + r.amountCents, 0);
  return Math.max(payment.refundedCents, sum("SUCCEEDED")) + sum("PENDING");
}

/** The most that can still be refunded: amount paid − refunds already made or in flight. Never negative. */
export function maxRefundableCents(payment: RefundablePayment, ledger: readonly LedgerRefund[]): Cents {
  if (!REFUNDABLE_PAYMENT_STATUSES.includes(payment.status)) return 0;
  return Math.max(0, payment.amountCents - committedRefundCents(payment, ledger));
}

export type RefundAmountCheck = { ok: true } | { ok: false; error: string };

export function checkRefundAmount(amountCents: number, maxCents: Cents): RefundAmountCheck {
  if (!Number.isSafeInteger(amountCents) || amountCents <= 0) return { ok: false, error: "Enter a refund amount greater than zero." };
  if (maxCents <= 0) return { ok: false, error: "Nothing is left to refund on this payment." };
  if (amountCents > maxCents) return { ok: false, error: "That's more than can be refunded on this payment." };
  return { ok: true };
}

/** Policy refund still owed on a REFUND_PENDING booking, after refunds already made or in flight. */
export function outstandingPolicyRefundCents(refundDueCents: Cents | null, payment: RefundablePayment, ledger: readonly LedgerRefund[]): Cents {
  if (!refundDueCents || refundDueCents <= 0) return 0;
  return Math.max(0, Math.min(refundDueCents - committedRefundCents(payment, ledger), maxRefundableCents(payment, ledger)));
}
