import "server-only";
import Stripe from "stripe";
import type { PaymentEvent } from "./events";

/**
 * Verify a Stripe webhook and normalise it. `constructEvent` checks the HMAC signature against
 * the endpoint secret and rejects stale timestamps (replay protection); it throws on any mismatch.
 */
export function verifyStripeEvent(payload: string, signature: string, webhookSecret: string): Stripe.Event {
  return Stripe.webhooks.constructEvent(payload, signature, webhookSecret);
}

/** Map the Stripe events we act on; everything else is recorded as ignored. */
export function toPaymentEvent(event: Stripe.Event): PaymentEvent {
  const base = { provider: "stripe" as const, eventId: event.id, eventType: event.type };
  switch (event.type) {
    case "payment_intent.succeeded": {
      const pi = event.data.object;
      return { ...base, kind: "succeeded", providerPaymentId: pi.id, amountCents: pi.amount_received, currency: pi.currency, reference: pi.metadata?.bookingReference ?? null };
    }
    case "payment_intent.payment_failed": {
      const pi = event.data.object;
      const err = pi.last_payment_error;
      return {
        ...base,
        kind: "failed",
        providerPaymentId: pi.id,
        currency: pi.currency,
        reference: pi.metadata?.bookingReference ?? null,
        // Codes only (e.g. "card_declined"/"insufficient_funds") — never messages or card details.
        failureCode: err?.decline_code ?? err?.code ?? "payment_failed",
      };
    }
    case "payment_intent.processing": {
      const pi = event.data.object;
      return { ...base, kind: "processing", providerPaymentId: pi.id, currency: pi.currency, reference: pi.metadata?.bookingReference ?? null };
    }
    case "payment_intent.canceled": {
      const pi = event.data.object;
      return { ...base, kind: "canceled", providerPaymentId: pi.id, currency: pi.currency, reference: pi.metadata?.bookingReference ?? null };
    }
    case "charge.refunded": {
      const charge = event.data.object;
      const pi = typeof charge.payment_intent === "string" ? charge.payment_intent : (charge.payment_intent?.id ?? null);
      return { ...base, kind: "refunded", providerPaymentId: pi, currency: charge.currency, refundedCents: charge.amount_refunded };
    }
    default:
      return { ...base, kind: "ignored", providerPaymentId: null };
  }
}
