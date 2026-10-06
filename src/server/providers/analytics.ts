import "server-only";
import { env } from "@/server/env";
import type { RefundReason } from "@/server/payments/refunds";

/**
 * Analytics abstraction. Events are typed so every call site sends a consistent payload.
 * No provider is required for development; add one by implementing `AnalyticsProvider`.
 * Never include personal data (emails, names, addresses) in event properties.
 */
export type AnalyticsEvent =
  | { name: "search_performed"; properties: { origin: string; maxDriveHours?: number; destination?: string; guests: number; hasDates: boolean; resultCount: number; collection?: string } }
  | { name: "search_filtered"; properties: { filterCount: number; amenities: string[]; types: string[]; hasPriceFilter: boolean; resultCount: number } }
  | { name: "property_viewed"; properties: { propertyId: string } }
  | { name: "property_saved"; properties: { propertyId: string } }
  | { name: "property_unsaved"; properties: { propertyId: string } }
  | { name: "booking_preview_opened"; properties: { propertyId: string; nights: number; guests: number } }
  | { name: "account_profile_updated"; properties: { fields: string[] } }
  | { name: "password_reset_requested"; properties: Record<string, never> }
  | { name: "password_reset_completed"; properties: Record<string, never> }
  | { name: "host_onboarding_started"; properties: Record<string, never> }
  | { name: "host_profile_completed"; properties: { hostType: string } }
  | { name: "property_creation_started"; properties: Record<string, never> }
  | { name: "property_created"; properties: { propertyId: string; type: string } }
  | { name: "property_photo_uploaded"; properties: { propertyId: string } }
  | { name: "property_pricing_completed"; properties: { propertyId: string } }
  | { name: "property_previewed"; properties: { propertyId: string } }
  | { name: "property_submitted"; properties: { propertyId: string } }
  | { name: "property_paused"; properties: { propertyId: string } }
  | { name: "booking_quote_created"; properties: { propertyId: string; bookingId: string; nights: number; guests: number; totalCents: number; currency: string } }
  | { name: "checkout_started"; properties: { propertyId: string; bookingId: string; nights: number } }
  | { name: "payment_started"; properties: { bookingId: string; provider: string } }
  | { name: "payment_succeeded"; properties: { bookingId: string; provider: string; amountCents: number; currency: string } }
  | { name: "payment_failed"; properties: { bookingId: string; provider: string; failureCode?: string } }
  | { name: "booking_confirmed"; properties: { bookingId: string; propertyId: string } }
  | { name: "booking_cancelled"; properties: { bookingId: string; by: "guest" | "admin"; refundCents: number } }
  | { name: "refund_requested"; properties: { bookingId: string; amountCents: number; reason: RefundReason } }
  | { name: "host_signup_started"; properties: Record<string, never> }
  | { name: "host_listing_submitted"; properties: { propertyId: string } }
  // Admin operations: identifiers and outcomes only. AdminAction remains the authoritative record.
  | { name: "property_review_started"; properties: { propertyId: string } }
  | { name: "property_approved"; properties: { propertyId: string } }
  | { name: "property_changes_requested"; properties: { propertyId: string; category: string } }
  | { name: "property_rejected"; properties: { propertyId: string; category: string } }
  | { name: "property_suspended"; properties: { propertyId: string } }
  | { name: "compliance_reviewed"; properties: { documentId: string; decision: string } }
  | { name: "refund_reviewed"; properties: { bookingId: string; decision: "executed" | "declined"; amountCents: number } }
  | { name: "host_suspended"; properties: { hostUserId: string; listingsSuspended: number } }
  | { name: "customer_suspended"; properties: { userId: string } }
  | { name: "account_reactivated"; properties: { userId: string } }
  | { name: "commission_schedule_created"; properties: { scheduleId: string } };

export interface AnalyticsProvider {
  track(event: AnalyticsEvent & { userId?: string }): Promise<void>;
}

class ConsoleAnalytics implements AnalyticsProvider {
  async track(event: AnalyticsEvent & { userId?: string }) {
    console.info(`[analytics] ${event.name}`, JSON.stringify(event.properties));
  }
}

class NoopAnalytics implements AnalyticsProvider {
  async track() {}
}

let provider: AnalyticsProvider | undefined;

function getProvider(): AnalyticsProvider {
  if (provider) return provider;
  const configured = env().ANALYTICS_PROVIDER ?? (env().NODE_ENV === "development" ? "console" : "none");
  provider = configured === "console" ? new ConsoleAnalytics() : new NoopAnalytics();
  return provider;
}

/** Fire-and-forget: analytics failures must never break a user request. */
export function track(event: AnalyticsEvent & { userId?: string }): void {
  getProvider()
    .track(event)
    .catch(() => {});
}
