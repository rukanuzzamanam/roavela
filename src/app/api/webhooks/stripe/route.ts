import { NextResponse, type NextRequest } from "next/server";
import { errorFields, log } from "@/server/log";
import { processPaymentEvent } from "@/server/payments/events";
import { getPaymentConfig } from "@/server/payments/provider";
import { toPaymentEvent, verifyStripeEvent } from "@/server/payments/stripe-events";
import { getRateLimiter, RATE_LIMITS } from "@/server/rate-limit";

/**
 * Stripe webhook endpoint — the ONLY route that can confirm a Stripe-paid booking.
 * The raw body is verified against STRIPE_WEBHOOK_SECRET before anything is parsed or trusted.
 * Responses: 400 for unverifiable requests, 500 for transient failures (Stripe retries), 200 once
 * an event is recorded — including events we deliberately ignore or reject.
 */
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const limit = await getRateLimiter().consume(`webhook:${ip}`, RATE_LIMITS.webhook);
  if (!limit.success) return NextResponse.json({ error: "Too many requests" }, { status: 429 });

  const config = getPaymentConfig();
  if (!config.ok || config.provider !== "stripe") {
    return NextResponse.json({ error: "Stripe webhooks are not configured" }, { status: 503 });
  }

  const signature = request.headers.get("stripe-signature");
  if (!signature) return NextResponse.json({ error: "Missing signature" }, { status: 400 });

  const payload = await request.text();
  let event;
  try {
    event = verifyStripeEvent(payload, signature, config.webhookSecret);
  } catch {
    log.warn("webhook.signature_invalid", { ip });
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }
  if (event.livemode) {
    // Belt and braces: a live event can never be processed in this test-mode-only build.
    log.error("webhook.livemode_event_refused", { eventId: event.id, type: event.type });
    return NextResponse.json({ received: true, outcome: "rejected" });
  }

  try {
    const result = await processPaymentEvent(toPaymentEvent(event));
    log.info("webhook.processed", { eventId: event.id, type: event.type, outcome: result.outcome });
    return NextResponse.json({ received: true, outcome: result.outcome });
  } catch (e) {
    log.error("webhook.failed", { eventId: event.id, type: event.type, ...errorFields(e) });
    return NextResponse.json({ error: "Processing failed" }, { status: 500 });
  }
}
