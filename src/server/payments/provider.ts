import "server-only";
import { randomBytes } from "node:crypto";
import Stripe from "stripe";
import { evaluatePaymentConfig, type PaymentConfig } from "@/lib/payment-config";

/**
 * Payment-provider abstraction. The server always supplies the amount and currency from the
 * booking's stored snapshot — never from the browser. Card details only ever go to Stripe's
 * hosted fields; Roavela never sees or stores them.
 */
export interface PaymentProvider {
  readonly name: "stripe" | "mock";
  /** Create (or safely re-create, via idempotency key) the payment for a booking. */
  createPayment(input: { bookingId: string; reference: string; amountCents: number; currency: string; idempotencyKey: string }): Promise<{ providerPaymentId: string }>;
  /** Client secret for the browser's payment form. Never stored. */
  getClientSecret(providerPaymentId: string): Promise<string | null>;
  /** Stop an unpaid payment (e.g. when a checkout hold expires). Best effort. */
  cancelPayment(providerPaymentId: string): Promise<void>;
  /** Request a refund. The refund is only recorded as complete when the provider confirms it. */
  refund(input: { providerPaymentId: string; amountCents: number; idempotencyKey: string }): Promise<{ refundId: string }>;
}

export class StripePaymentProvider implements PaymentProvider {
  readonly name = "stripe" as const;
  readonly client: Stripe;
  constructor(secretKey: string) {
    // Uses the API version pinned by the installed SDK (stripe@22 → 2026-08-26.dahlia).
    this.client = new Stripe(secretKey, { maxNetworkRetries: 2, appInfo: { name: "Roavela" } });
  }

  async createPayment({ bookingId, reference, amountCents, currency, idempotencyKey }: Parameters<PaymentProvider["createPayment"]>[0]) {
    const intent = await this.client.paymentIntents.create(
      {
        amount: amountCents,
        currency: currency.toLowerCase(),
        automatic_payment_methods: { enabled: true },
        description: `Roavela booking ${reference}`,
        metadata: { bookingId, bookingReference: reference },
      },
      { idempotencyKey },
    );
    return { providerPaymentId: intent.id };
  }

  async getClientSecret(providerPaymentId: string) {
    const intent = await this.client.paymentIntents.retrieve(providerPaymentId);
    return ["requires_payment_method", "requires_confirmation", "requires_action"].includes(intent.status) ? intent.client_secret : null;
  }

  async cancelPayment(providerPaymentId: string) {
    const intent = await this.client.paymentIntents.retrieve(providerPaymentId);
    if (["requires_payment_method", "requires_confirmation", "requires_action", "requires_capture"].includes(intent.status)) {
      await this.client.paymentIntents.cancel(providerPaymentId);
    }
  }

  async refund({ providerPaymentId, amountCents, idempotencyKey }: Parameters<PaymentProvider["refund"]>[0]) {
    const refund = await this.client.refunds.create({ payment_intent: providerPaymentId, amount: amountCents }, { idempotencyKey });
    return { refundId: refund.id };
  }
}

/**
 * Development-only simulated provider, used when no Stripe test keys are configured. It never
 * talks to a network or handles card data; outcomes are triggered explicitly in the UI and flow
 * through the SAME event-processing code as real Stripe webhooks. Refused in production.
 */
export class MockPaymentProvider implements PaymentProvider {
  readonly name = "mock" as const;
  async createPayment({ idempotencyKey }: Parameters<PaymentProvider["createPayment"]>[0]) {
    // Deterministic per idempotency key, mirroring Stripe's behaviour for retried requests.
    return { providerPaymentId: `mock_pi_${Buffer.from(idempotencyKey).toString("base64url").slice(-24)}` };
  }
  async getClientSecret(providerPaymentId: string) {
    return `${providerPaymentId}_secret_mock`;
  }
  async cancelPayment() {}
  async refund() {
    return { refundId: `mock_re_${randomBytes(8).toString("hex")}` };
  }
}

let override: PaymentProvider | undefined;
let cached: { key: string; provider: PaymentProvider } | undefined;

export function getPaymentConfig(): PaymentConfig {
  return evaluatePaymentConfig(process.env);
}

/** The active provider, or an explanatory configuration error (never a silent fallback). */
export function getPaymentProvider(): { ok: true; provider: PaymentProvider; config: PaymentConfig & { ok: true } } | { ok: false; error: string } {
  const config = getPaymentConfig();
  if (!config.ok) return config;
  if (override) return { ok: true, provider: override, config };
  const key = config.provider === "stripe" ? config.secretKey : "mock";
  if (!cached || cached.key !== key) {
    cached = { key, provider: config.provider === "stripe" ? new StripePaymentProvider(config.secretKey) : new MockPaymentProvider() };
  }
  return { ok: true, provider: cached.provider, config };
}

/** Test hook. */
export function setPaymentProviderForTests(p: PaymentProvider | undefined) {
  override = p;
}
