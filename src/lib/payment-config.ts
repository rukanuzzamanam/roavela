/**
 * Payment configuration guard. Phase 4 is TEST MODE ONLY: live Stripe keys are refused outright,
 * and the development mock provider is refused in production so nothing ever "pretends" to charge.
 * Pure so the rules are unit-testable.
 */
export type PaymentConfig =
  | { ok: true; provider: "stripe"; secretKey: string; publishableKey: string; webhookSecret: string }
  | { ok: true; provider: "mock" }
  | { ok: false; error: string };

export interface PaymentEnv {
  NODE_ENV?: string;
  STRIPE_MODE?: string;
  STRIPE_SECRET_KEY?: string;
  NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  PAYMENT_PROVIDER?: string;
}

const isLive = (v?: string) => Boolean(v && /^(sk|rk|pk)_live_/.test(v));

export function evaluatePaymentConfig(e: PaymentEnv): PaymentConfig {
  const secret = e.STRIPE_SECRET_KEY?.trim() || "";
  const publishable = e.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY?.trim() || "";
  const webhookSecret = e.STRIPE_WEBHOOK_SECRET?.trim() || "";
  const requested = (e.PAYMENT_PROVIDER?.trim() || "auto").toLowerCase();

  if (isLive(secret) || isLive(publishable)) {
    return { ok: false, error: "Live Stripe keys were detected. Live payments are not enabled — use Stripe test-mode keys (sk_test_/pk_test_)." };
  }
  if ((e.STRIPE_MODE?.trim() || "test") !== "test") {
    return { ok: false, error: `STRIPE_MODE="${e.STRIPE_MODE}" is not supported. Only STRIPE_MODE=test is enabled.` };
  }

  const wantsStripe = requested === "stripe" || (requested === "auto" && Boolean(secret));
  if (wantsStripe) {
    if (!/^(sk|rk)_test_/.test(secret)) return { ok: false, error: "STRIPE_SECRET_KEY must be a Stripe test-mode key (sk_test_… or rk_test_…)." };
    if (!/^pk_test_/.test(publishable)) return { ok: false, error: "NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY must be a Stripe test-mode publishable key (pk_test_…)." };
    if (!/^whsec_/.test(webhookSecret)) return { ok: false, error: "STRIPE_WEBHOOK_SECRET is required (whsec_…). Payments are only confirmed by verified webhooks." };
    return { ok: true, provider: "stripe", secretKey: secret, publishableKey: publishable, webhookSecret };
  }

  if (requested !== "auto" && requested !== "mock") return { ok: false, error: `Unknown PAYMENT_PROVIDER "${requested}".` };
  if (e.NODE_ENV === "production") {
    return { ok: false, error: "Payments aren't configured. The simulated payment provider is disabled in production — configure Stripe test-mode keys." };
  }
  return { ok: true, provider: "mock" };
}
