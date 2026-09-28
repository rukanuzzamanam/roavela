import "server-only";
import { env } from "@/server/env";

/**
 * Analytics abstraction. Events are typed so every call site sends a consistent payload.
 * No provider is required for development; add one by implementing `AnalyticsProvider`.
 * Never include personal data (emails, names, addresses) in event properties.
 */
export type AnalyticsEvent =
  | { name: "search_performed"; properties: { origin: string; maxDriveHours?: number; destination?: string; guests: number; hasDates: boolean; resultCount: number; collection?: string } }
  | { name: "property_viewed"; properties: { propertyId: string } }
  | { name: "property_saved"; properties: { propertyId: string; saved: boolean } }
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
