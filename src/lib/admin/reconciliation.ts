import type { BookingStatus, PaymentStatus, RefundStatus } from "@/generated/prisma/enums";
import type { Cents } from "@/lib/money";
import { applyBps, PRICING_RULES_VERSION } from "@/lib/pricing";

/**
 * Financial reconciliation for one booking. It re-derives every figure from the booking's own
 * immutable snapshot (never from current prices or the current fee schedule) and compares it with
 * what was stored and what the payment provider reported.
 *
 * It NEVER repairs anything: an inconsistency is returned as an issue for a human to investigate.
 * Platform figures are GROSS revenue, not profit. Processing fees are only used when actually
 * recorded — they are never estimated.
 */

export interface ReconcileBooking {
  status: BookingStatus;
  isDemo: boolean;
  currency: string;
  accommodationCents: Cents;
  cleaningFeeCents: Cents;
  guestServiceFeeCents: Cents;
  totalCents: Cents;
  hostCommissionCents: Cents;
  hostPayoutCents: Cents;
  platformRevenueCents: Cents;
  guestServiceFeeBps: number;
  hostCommissionBps: number;
  refundDueCents: Cents | null;
  pricingSnapshot: unknown;
}

export interface ReconcilePayment {
  status: PaymentStatus;
  amountCents: Cents;
  refundedCents: Cents;
  currency: string;
  processingFeeCents: Cents | null;
}

export interface ReconcileRefund {
  status: RefundStatus;
  amountCents: Cents;
  currency: string;
}

export type IssueCode =
  | "currency_mismatch"
  | "guest_total_mismatch"
  | "nightly_rates_mismatch"
  | "guest_fee_mismatch"
  | "commission_mismatch"
  | "fee_snapshot_mismatch"
  | "platform_revenue_mismatch"
  | "host_proceeds_mismatch"
  | "split_mismatch"
  | "unknown_rules_version"
  | "payment_amount_mismatch"
  | "no_captured_payment"
  | "multiple_captured_payments"
  | "over_refunded"
  | "refund_ledger_exceeds_payment"
  | "refund_due_exceeds_paid"
  | "refund_state_mismatch";

export interface ReconcileIssue {
  code: IssueCode;
  severity: "error" | "warning";
  message: string;
}

export interface Reconciliation {
  guestTotalCents: Cents;
  accommodationCents: Cents;
  cleaningFeeCents: Cents;
  guestServiceFeeCents: Cents;
  hostCommissionCents: Cents;
  /** Guest service fee + host commission. GROSS — not profit. */
  platformGrossRevenueCents: Cents;
  /** Accommodation − host commission + cleaning fee. Accrued estimate; no payout has been made. */
  estimatedHostProceedsCents: Cents;
  paidCents: Cents;
  /** Cumulative refunds confirmed by the payment provider. */
  providerRefundedCents: Cents;
  /** Refunds requested from the provider but not yet confirmed. */
  refundsInFlightCents: Cents;
  /** Only when the provider reported it; null means unknown (never estimated). */
  processingFeeCents: Cents | null;
  /** Platform gross revenue − processing fee, only when both are known and nothing was refunded. */
  netPlatformCents: Cents | null;
  issues: ReconcileIssue[];
}

export const CAPTURED_PAYMENT_STATUSES: readonly PaymentStatus[] = ["SUCCEEDED", "PARTIALLY_REFUNDED", "REFUNDED"];
/** Booking statuses that can only exist after a verified payment. */
const PAID_BOOKING_STATUSES: readonly BookingStatus[] = ["CONFIRMED", "COMPLETED", "REFUND_PENDING", "REFUNDED"];

function nightlySum(snapshot: unknown): Cents | null {
  const rates = (snapshot as { nightlyRates?: unknown } | null)?.nightlyRates;
  if (!Array.isArray(rates) || rates.length === 0) return null;
  let sum = 0;
  for (const r of rates) {
    const cents = (r as { cents?: unknown })?.cents;
    if (!Number.isSafeInteger(cents)) return null;
    sum += cents as number;
  }
  return sum;
}

export function reconcileBooking(b: ReconcileBooking, payments: readonly ReconcilePayment[], refunds: readonly ReconcileRefund[]): Reconciliation {
  const issues: ReconcileIssue[] = [];
  const flag = (code: IssueCode, message: string, severity: "error" | "warning" = "error") => issues.push({ code, severity, message });
  const currency = b.currency.toUpperCase();

  // Currency must agree everywhere.
  if (payments.some((p) => p.currency.toUpperCase() !== currency) || refunds.some((r) => r.currency.toUpperCase() !== currency)) {
    flag("currency_mismatch", "A payment or refund is in a different currency from the booking.");
  }

  // The stored split must be internally consistent.
  if (b.totalCents !== b.accommodationCents + b.cleaningFeeCents + b.guestServiceFeeCents) {
    flag("guest_total_mismatch", "Guest total ≠ accommodation + cleaning fee + guest service fee.");
  }
  const nightly = nightlySum(b.pricingSnapshot);
  if (nightly !== null && nightly !== b.accommodationCents) flag("nightly_rates_mismatch", "Accommodation ≠ sum of the snapshot's nightly rates.");

  const snapshot = (b.pricingSnapshot ?? null) as { rulesVersion?: unknown; feeSchedule?: { guestServiceFeeBps?: unknown; hostCommissionBps?: unknown } } | null;
  const rulesVersion = snapshot?.rulesVersion;
  if (rulesVersion === PRICING_RULES_VERSION) {
    if (b.guestServiceFeeCents !== applyBps(b.accommodationCents, b.guestServiceFeeBps)) {
      flag("guest_fee_mismatch", "Guest service fee doesn't match the snapshot rate applied to accommodation.");
    }
    if (b.hostCommissionCents !== applyBps(b.accommodationCents, b.hostCommissionBps)) {
      flag("commission_mismatch", "Host commission doesn't match the snapshot rate applied to accommodation.");
    }
  } else {
    flag("unknown_rules_version", "The booking's pricing rules version can't be verified automatically.", "warning");
  }
  const fs = snapshot?.feeSchedule;
  if (fs && (fs.guestServiceFeeBps !== b.guestServiceFeeBps || fs.hostCommissionBps !== b.hostCommissionBps)) {
    flag("fee_snapshot_mismatch", "Fee rates on the booking differ from its own fee-schedule snapshot.");
  }
  if (b.platformRevenueCents !== b.guestServiceFeeCents + b.hostCommissionCents) {
    flag("platform_revenue_mismatch", "Platform gross revenue ≠ guest service fee + host commission.");
  }
  if (b.hostPayoutCents !== b.accommodationCents - b.hostCommissionCents + b.cleaningFeeCents) {
    flag("host_proceeds_mismatch", "Estimated host proceeds ≠ accommodation − commission + cleaning fee.");
  }
  if (b.totalCents !== b.hostPayoutCents + b.platformRevenueCents) {
    flag("split_mismatch", "Guest total ≠ host proceeds + platform gross revenue.");
  }

  // Payments and refunds against the snapshot.
  const captured = payments.filter((p) => CAPTURED_PAYMENT_STATUSES.includes(p.status));
  const paidCents = captured.reduce((t, p) => t + p.amountCents, 0);
  const providerRefundedCents = captured.reduce((t, p) => t + p.refundedCents, 0);
  if (captured.length > 1) flag("multiple_captured_payments", "More than one captured payment exists for this booking.", "warning");
  if (captured.some((p) => p.amountCents !== b.totalCents)) flag("payment_amount_mismatch", "A captured payment differs from the booking's guest total.");
  if (captured.length === 0 && PAID_BOOKING_STATUSES.includes(b.status) && !b.isDemo) {
    flag("no_captured_payment", "The booking is in a paid status but no captured payment is recorded.");
  }
  if (providerRefundedCents > paidCents) flag("over_refunded", "Refunded amount exceeds the amount paid.");

  const ledgerCents = refunds.filter((r) => r.status === "SUCCEEDED" || r.status === "PENDING").reduce((t, r) => t + r.amountCents, 0);
  const refundsInFlightCents = refunds.filter((r) => r.status === "PENDING").reduce((t, r) => t + r.amountCents, 0);
  if (ledgerCents > paidCents) flag("refund_ledger_exceeds_payment", "Refunds requested exceed the amount paid.");
  if (b.refundDueCents !== null && b.refundDueCents > paidCents && captured.length > 0) {
    flag("refund_due_exceeds_paid", "Refund due under the policy exceeds the amount paid.");
  }
  if (b.status === "REFUNDED" && providerRefundedCents < (b.refundDueCents ?? 0)) {
    flag("refund_state_mismatch", "Booking is marked refunded but the provider has confirmed less than the refund due.");
  }

  const fees = captured.map((p) => p.processingFeeCents);
  const processingFeeCents = fees.length > 0 && fees.every((f) => f !== null) ? fees.reduce<number>((t, f) => t + (f ?? 0), 0) : null;
  const netPlatformCents = processingFeeCents !== null && providerRefundedCents === 0 && refundsInFlightCents === 0 ? b.platformRevenueCents - processingFeeCents : null;

  return {
    guestTotalCents: b.totalCents,
    accommodationCents: b.accommodationCents,
    cleaningFeeCents: b.cleaningFeeCents,
    guestServiceFeeCents: b.guestServiceFeeCents,
    hostCommissionCents: b.hostCommissionCents,
    platformGrossRevenueCents: b.platformRevenueCents,
    estimatedHostProceedsCents: b.hostPayoutCents,
    paidCents,
    providerRefundedCents,
    refundsInFlightCents,
    processingFeeCents,
    netPlatformCents,
    issues,
  };
}

export const hasBlockingIssues = (r: Reconciliation) => r.issues.some((i) => i.severity === "error");
