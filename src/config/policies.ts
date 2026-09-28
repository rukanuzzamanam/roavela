import type { CancellationPolicy } from "@/generated/prisma/enums";

/** Guest-facing cancellation policy copy. Enforcement arrives with the booking engine. */
export const CANCELLATION_COPY: Record<CancellationPolicy, { title: string; body: string }> = {
  FLEXIBLE: { title: "Flexible", body: "Full refund up to 24 hours before check-in." },
  MODERATE: { title: "Moderate", body: "Full refund up to 5 days before check-in. 50% refund after that, up until check-in." },
  STRICT: { title: "Strict", body: "50% refund up to 14 days before check-in. No refund after that." },
};
