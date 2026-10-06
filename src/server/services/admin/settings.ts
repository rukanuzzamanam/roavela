import "server-only";
import { env } from "@/server/env";
import { getPaymentConfig } from "@/server/payments/provider";
import { getActiveFeeSchedule } from "@/server/services/fees";

/**
 * Read-only operational configuration for the admin Settings page. Reports MODES and whether
 * things are configured — never the values of keys, secrets or connection strings.
 */
export async function getOperationalSettings() {
  const e = env();
  const payment = getPaymentConfig();
  const fees = await getActiveFeeSchedule("AU").catch(() => null);
  return {
    environment: e.NODE_ENV,
    payments: payment.ok
      ? { status: "ok" as const, provider: payment.provider, mode: "TEST" as const, webhookConfigured: payment.provider === "stripe" }
      : { status: "error" as const, message: payment.error },
    payouts: "Not enabled — host proceeds are estimates only; no money is transferred to hosts.",
    email: e.RESEND_API_KEY ? "Resend (transactional email)" : "Development console adapter (no email is sent)",
    storage: e.STORAGE_PROVIDER === "local" ? `Local disk (${e.NODE_ENV === "production" ? "production use explicitly allowed" : "development"})` : e.STORAGE_PROVIDER,
    analytics: e.ANALYTICS_PROVIDER ?? (e.NODE_ENV === "development" ? "console" : "none"),
    demoListingsVisible: e.NODE_ENV !== "production" || e.SHOW_DEMO_LISTINGS,
    activeFees: fees,
  };
}
