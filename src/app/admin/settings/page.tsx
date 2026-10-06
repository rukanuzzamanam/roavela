import type { Metadata } from "next";
import { AdminHeader, Facts, Notice, TestModeBadge } from "@/components/admin/admin-ui";
import { Card } from "@/components/ui/feedback";
import { formatBps } from "@/lib/admin/commission";
import { requireAdmin } from "@/server/auth/admin-guard";
import { getOperationalSettings } from "@/server/services/admin/settings";

export const metadata: Metadata = { title: "Settings" };

/** Read-only: configuration lives in environment variables and is never editable from the browser. */
export default async function AdminSettingsPage() {
  await requireAdmin("admin:config:manage", "/admin/settings");
  const s = await getOperationalSettings();
  return (
    <>
      <AdminHeader eyebrow="Admin" title="Settings" description="Operational configuration, read-only. Secrets are never displayed — only whether something is configured." />
      {s.payments.status === "error" && (
        <div className="mb-4">
          <Notice tone="warning">Payments are disabled: {s.payments.message}</Notice>
        </div>
      )}
      <Card className="p-5">
        <Facts
          items={[
            ["Environment", s.environment],
            [
              "Payments",
              s.payments.status === "ok" ? (
                <span key="p" className="inline-flex items-center gap-2">
                  <TestModeBadge /> {s.payments.provider === "stripe" ? "Stripe (test keys, verified webhooks)" : "Development simulator (no Stripe keys)"}
                </span>
              ) : (
                "Not available"
              ),
            ],
            ["Live payments", "Disabled — live Stripe keys are refused"],
            ["Host payouts", s.payouts],
            ["Active fees (AU)", s.activeFees ? `${s.activeFees.name}: guest ${formatBps(s.activeFees.guestServiceFeeBps)} · host ${formatBps(s.activeFees.hostCommissionBps)}` : "None configured"],
            ["Email", s.email],
            ["File storage", s.storage],
            ["Analytics", s.analytics],
            ["Demo listings visible", s.demoListingsVisible ? "Yes" : "No"],
          ]}
        />
      </Card>
    </>
  );
}
