import type { Metadata } from "next";
import { ConfirmAction } from "@/components/admin/admin-forms";
import { AdminHeader, AdminTable, dateTime, Notice, Section, StatusPill } from "@/components/admin/admin-ui";
import { EmptyState } from "@/components/ui/feedback";
import { COMMISSION_BOUNDS, formatBps } from "@/lib/admin/commission";
import { ADMIN_TIMEZONE } from "@/lib/admin/ranges";
import { todayInTimeZone, toIsoDate } from "@/lib/dates";
import { createCommissionAction } from "@/server/actions/admin-operations";
import { requireAdmin } from "@/server/auth/admin-guard";
import { listFeeSchedules } from "@/server/services/admin/commission";

export const metadata: Metadata = { title: "Commission" };

const STATE = { active: { label: "Active", tone: "success" }, scheduled: { label: "Scheduled", tone: "warning" }, superseded: { label: "Superseded", tone: "neutral" } } as const;

export default async function AdminCommissionPage() {
  await requireAdmin("admin:commission:manage", "/admin/commission");
  const schedules = await listFeeSchedules();
  const hasCountrySpecific = schedules.some((s) => s.countryCode !== null);
  const g = COMMISSION_BOUNDS.guestServiceFeeBps;
  const h = COMMISSION_BOUNDS.hostCommissionBps;

  return (
    <>
      <AdminHeader eyebrow="Admin" title="Commission" description="Marketplace fees are versioned schedules. A change creates a new schedule with an effective date — it never edits an existing one." />
      <div className="mb-6 space-y-3">
        <Notice>
          Every booking stores the fee rates and schedule in force when it was made. Changing commission only affects bookings created after the new schedule takes effect — historical bookings never change. Both fees are charged on the accommodation amount; the cleaning fee is passed to the host in full.
        </Notice>
        {hasCountrySpecific && <Notice tone="warning">A country-specific schedule exists. Country-specific schedules take precedence over the global schedule managed here.</Notice>}
      </div>

      <Section id="schedules" title="Schedules" className="mb-10">
        <AdminTable
          caption="Fee schedules"
          columns={[{ label: "Schedule" }, { label: "Guest service fee" }, { label: "Host commission" }, { label: "Effective from" }, { label: "State" }, { label: "Bookings using it" }]}
          rows={schedules.map((s) => ({
            key: s.id,
            cells: [
              <div key="n">
                <p className="font-semibold">{s.name}</p>
                <p className="text-xs text-mist">
                  {s.countryCode ?? "All countries"} · created {dateTime(s.createdAt)}
                  {s.createdBy && <> by {s.createdBy.name}</>}
                </p>
              </div>,
              <span key="g">{formatBps(s.guestServiceFeeBps)}</span>,
              <span key="h">{formatBps(s.hostCommissionBps)}</span>,
              <span key="e">{dateTime(s.effectiveFrom)}</span>,
              <StatusPill key="s" tone={STATE[s.state].tone}>
                {STATE[s.state].label}
              </StatusPill>,
              <span key="b">{s._count.bookings}</span>,
            ],
          }))}
          empty={<EmptyState icon="filter" title="No fee schedule configured" description="Bookings can't be priced until a schedule exists." />}
        />
      </Section>

      <Section id="new" title="Schedule a change" description={`Guest service fee ${formatBps(g.min)}–${formatBps(g.max)} · host commission ${formatBps(h.min)}–${formatBps(h.max)}. Effective dates can't be in the past; today takes effect immediately.`}>
        <ConfirmAction
          action={createCommissionAction}
          hidden={{}}
          tone="primary"
          label="Create new schedule"
          title="New global commission schedule"
          description="All values are validated on the server. This is recorded in the audit log."
          confirmLabel="Create schedule"
          fields={[
            { type: "text", name: "name", label: "Schedule name", required: true, placeholder: "e.g. 2027 marketplace fees", maxLength: 80 },
            { type: "text", name: "guestServiceFeeBps", label: "Guest service fee (%)", required: true, inputMode: "decimal", placeholder: "e.g. 12 or 12.5", maxLength: 6 },
            { type: "text", name: "hostCommissionBps", label: "Host commission (%)", required: true, inputMode: "decimal", placeholder: "e.g. 3", maxLength: 6 },
            { type: "text", name: "effectiveDate", label: "Effective date (Sydney time)", required: true, inputType: "date", defaultValue: toIsoDate(todayInTimeZone(ADMIN_TIMEZONE)) },
            { type: "textarea", name: "reason", label: "Reason for the change", required: true, rows: 2, maxLength: 500 },
            { type: "checkbox", name: "confirmed", label: "I understand this changes the fees on new bookings from the effective date, and existing bookings keep their original rates.", required: true },
          ]}
        />
      </Section>
    </>
  );
}
