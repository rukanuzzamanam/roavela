import "server-only";
import { env } from "@/server/env";

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
  | { name: "checkout_started"; properties: { propertyId: string; nights: number } }
  | { name: "booking_completed"; properties: { bookingId: string } }
  | { name: "host_signup_started"; properties: Record<string, never> }
  | { name: "host_listing_submitted"; properties: { propertyId: string } };

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
