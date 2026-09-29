import type { BookingStatus, CancellationPolicy } from "@/generated/prisma/enums";
import { nightsBetween } from "./dates";

/**
 * Booking lifecycle — the only allowed status changes. Status is never accepted from a client;
 * server code names an event and this table decides the result.
 */
export type BookingEvent = "payment_confirmed" | "hold_expired" | "cancel_no_refund" | "cancel_with_refund" | "refund_confirmed" | "stay_completed";

const RULES: Record<BookingEvent, { from: readonly BookingStatus[]; to: BookingStatus }> = {
  // EXPIRED is allowed here: a payment that lands just after the hold lapsed can still confirm if
  // the dates are free (the DB exclusion constraint decides); otherwise it's refunded.
  payment_confirmed: { from: ["PENDING", "EXPIRED"], to: "CONFIRMED" },
  hold_expired: { from: ["PENDING"], to: "EXPIRED" },
  cancel_no_refund: { from: ["CONFIRMED"], to: "CANCELLED" },
  cancel_with_refund: { from: ["CONFIRMED"], to: "REFUND_PENDING" },
  refund_confirmed: { from: ["REFUND_PENDING"], to: "REFUNDED" },
  stay_completed: { from: ["CONFIRMED"], to: "COMPLETED" },
};

export function bookingTransition(event: BookingEvent, from: BookingStatus): BookingStatus | null {
  const rule = RULES[event];
  return rule.from.includes(from) ? rule.to : null;
}

/** Statuses that hold the property's dates. MUST match the Booking_no_overlap constraint. */
export const INVENTORY_HOLDING_STATUSES = ["PENDING", "CONFIRMED"] as const;

export const BOOKING_STATUS_LABELS: Record<BookingStatus, { label: string; tone: "neutral" | "success" | "warning" | "demo" }> = {
  PENDING: { label: "Awaiting payment", tone: "warning" },
  CONFIRMED: { label: "Confirmed", tone: "success" },
  CANCELLED: { label: "Cancelled", tone: "neutral" },
  COMPLETED: { label: "Completed", tone: "success" },
  REFUNDED: { label: "Refunded", tone: "neutral" },
  EXPIRED: { label: "Expired — not booked", tone: "neutral" },
  REFUND_PENDING: { label: "Cancelled · refund pending", tone: "warning" },
};

// ── Cancellation & refunds ────────────────────────────────────────────────────

export type RefundEligibility = "full" | "partial" | "none";

export interface CancellationQuote {
  eligibility: RefundEligibility;
  refundCents: number;
  explanation: string;
}

/**
 * Refund due under the policy SNAPSHOT stored on the booking (never the property's current policy).
 * Days are counted in calendar days before check-in, in the property's local calendar.
 *
 * MVP rules (plain-language, not legal advice):
 *  - FLEXIBLE: full refund up to 1 day before check-in; after that, no refund.
 *  - MODERATE: full refund 5+ days before; otherwise 50% of accommodation + the full cleaning fee
 *    (cleaning hasn't happened), until check-in.
 *  - STRICT:   50% of accommodation + cleaning fee 14+ days before; after that, no refund.
 *  The guest service fee is refunded only with a full refund.
 */
export function quoteCancellation(
  policy: CancellationPolicy,
  booking: { checkIn: Date; totalCents: number; accommodationCents: number; cleaningFeeCents: number },
  today: Date,
): CancellationQuote {
  const daysBefore = nightsBetween(today, booking.checkIn);
  if (daysBefore < 0) return { eligibility: "none", refundCents: 0, explanation: "This stay has already started, so it can't be cancelled online." };

  const partial = Math.floor(booking.accommodationCents / 2) + booking.cleaningFeeCents;
  switch (policy) {
    case "FLEXIBLE":
      return daysBefore >= 1
        ? { eligibility: "full", refundCents: booking.totalCents, explanation: "Flexible policy: cancelling at least a day before check-in gets a full refund." }
        : { eligibility: "none", refundCents: 0, explanation: "Flexible policy: cancellations on the day of check-in aren't refundable." };
    case "MODERATE":
      return daysBefore >= 5
        ? { eligibility: "full", refundCents: booking.totalCents, explanation: "Moderate policy: cancelling 5 or more days before check-in gets a full refund." }
        : { eligibility: "partial", refundCents: partial, explanation: "Moderate policy: within 5 days of check-in, 50% of the accommodation and the cleaning fee are refunded. The service fee isn't." };
    case "STRICT":
      return daysBefore >= 14
        ? { eligibility: "partial", refundCents: partial, explanation: "Strict policy: 14 or more days before check-in, 50% of the accommodation and the cleaning fee are refunded. The service fee isn't." }
        : { eligibility: "none", refundCents: 0, explanation: "Strict policy: within 14 days of check-in, cancellations aren't refundable." };
  }
}
