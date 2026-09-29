import type { CancellationPolicy } from "@/generated/prisma/enums";

/**
 * Guest-facing cancellation policy copy. MUST match quoteCancellation() in lib/booking-lifecycle,
 * which enforces these rules against each booking's policy snapshot.
 */
export const CANCELLATION_COPY: Record<CancellationPolicy, { title: string; body: string }> = {
  FLEXIBLE: { title: "Flexible", body: "Full refund if cancelled at least 1 day before check-in. No refund on the day of check-in." },
  MODERATE: { title: "Moderate", body: "Full refund if cancelled 5+ days before check-in. After that, 50% of the accommodation plus the cleaning fee is refunded, up until check-in." },
  STRICT: { title: "Strict", body: "50% of the accommodation plus the cleaning fee is refunded if cancelled 14+ days before check-in. No refund after that." },
};
