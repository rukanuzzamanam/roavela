import type { Metadata } from "next";
import { AdminHeader, AdminTable, DemoBadge, FilterTabs, InlineLink, money, Notice, ResultCount, selectClasses, StatusPill, TestModeBadge } from "@/components/admin/admin-ui";
import { EmptyState } from "@/components/ui/feedback";
import { Pagination } from "@/components/ui/pagination";
import { BOOKING_STATUS_LABELS } from "@/lib/booking-lifecycle";
import { ADMIN_PAGE_SIZE, first, listHref, pageCount, parsePage, type RawParams } from "@/lib/admin/query";
import { resolveRange } from "@/lib/admin/ranges";
import { requireAdmin } from "@/server/auth/admin-guard";
import { listReconciliation, RECONCILE_SCAN_LIMIT } from "@/server/services/admin/bookings";

export const metadata: Metadata = { title: "Reconciliation" };

export default async function ReconciliationPage({ searchParams }: { searchParams: Promise<RawParams> }) {
  await requireAdmin("admin:finance:view", "/admin/payments/reconciliation");
  const sp = await searchParams;
  const range = resolveRange({ range: first(sp, "range"), from: first(sp, "from"), to: first(sp, "to") });
  const issuesOnly = first(sp, "view") === "issues";
  const page = parsePage(sp);
  const { total, truncated, rows } = await listReconciliation({ from: range.from, to: range.to, issuesOnly, page });
  const filters = { range: range.preset, from: range.preset === "custom" ? range.firstDay : undefined, to: range.preset === "custom" ? range.lastDay : undefined, view: issuesOnly ? "issues" : undefined };

  return (
    <>
      <AdminHeader eyebrow="Payments" title="Financial reconciliation" description={`Paid bookings confirmed ${range.label.toLowerCase()} (${range.firstDay} – ${range.lastDay}). Every figure is re-derived from the booking's own snapshot and compared with the provider's records.`} />
      <div className="mb-4">
        <Notice>
          <span className="inline-flex flex-wrap items-center gap-2">
            <TestModeBadge /> Inconsistencies are flagged for investigation — nothing is ever repaired automatically. Platform figures are gross revenue, not profit, and processing fees are shown only when the provider reports them.
          </span>
        </Notice>
      </div>
      <form method="get" className="mb-4 flex flex-wrap items-end gap-2" aria-label="Date range">
        {issuesOnly && <input type="hidden" name="view" value="issues" />}
        <label className="text-sm">
          <span className="block font-semibold text-ink-soft">Range</span>
          <select name="range" defaultValue={range.preset} className={selectClasses()}>
            <option value="7d">Last 7 days</option>
            <option value="30d">Last 30 days</option>
            <option value="this_month">This month</option>
            <option value="prev_month">Previous month</option>
            <option value="custom">Custom</option>
          </select>
        </label>
        <label className="text-sm">
          <span className="block font-semibold text-ink-soft">From</span>
          <input type="date" name="from" defaultValue={range.preset === "custom" ? range.firstDay : undefined} className={selectClasses()} />
        </label>
        <label className="text-sm">
          <span className="block font-semibold text-ink-soft">To</span>
          <input type="date" name="to" defaultValue={range.preset === "custom" ? range.lastDay : undefined} className={selectClasses()} />
        </label>
        <button type="submit" className="h-11 rounded-full bg-eucalypt-700 px-5 text-sm font-semibold text-white hover:bg-eucalypt-800">
          Apply
        </button>
      </form>
      <FilterTabs
        label="Reconciliation view"
        items={[
          { href: listHref("/admin/payments/reconciliation", { ...filters, view: undefined }), label: "All bookings", active: !issuesOnly },
          { href: listHref("/admin/payments/reconciliation", { ...filters, view: "issues" }), label: "Flagged only", active: issuesOnly },
        ]}
      />
      {truncated && <p className="mb-3 text-sm text-ochre-700">Only the most recent {RECONCILE_SCAN_LIMIT.toLocaleString("en-AU")} bookings in this range were checked. Narrow the range to check the rest.</p>}
      <ResultCount total={total} page={page} pageSize={ADMIN_PAGE_SIZE} noun="bookings" />
      <AdminTable
        caption="Reconciliation"
        columns={[{ label: "Booking" }, { label: "Guest total" }, { label: "Accom. / cleaning" }, { label: "Guest fee + commission" }, { label: "Est. host proceeds" }, { label: "Paid / refunded" }, { label: "Checks" }]}
        rows={rows.map((b) => {
          const r = b.reconciliation;
          const c = b.currency;
          return {
            key: b.id,
            cells: [
              <div key="b" className="space-y-1">
                <InlineLink href={`/admin/bookings/${b.reference}`}>{b.reference}</InlineLink>
                <StatusPill tone={BOOKING_STATUS_LABELS[b.status].tone}>{BOOKING_STATUS_LABELS[b.status].label}</StatusPill>
                {b.isDemo && <DemoBadge />}
              </div>,
              <span key="t" className="tabular-nums">{money(r.guestTotalCents, c)}</span>,
              <span key="a" className="tabular-nums">
                {money(r.accommodationCents, c)} / {money(r.cleaningFeeCents, c)}
              </span>,
              <span key="f" className="tabular-nums">
                {money(r.guestServiceFeeCents, c)} + {money(r.hostCommissionCents, c)}
                <span className="block text-xs text-mist">= {money(r.platformGrossRevenueCents, c)} gross</span>
              </span>,
              <span key="h" className="tabular-nums">{money(r.estimatedHostProceedsCents, c)}</span>,
              <span key="p" className="tabular-nums">
                {money(r.paidCents, c)} / {money(r.providerRefundedCents, c)}
                {r.refundsInFlightCents > 0 && <span className="block text-xs text-mist">{money(r.refundsInFlightCents, c)} in flight</span>}
              </span>,
              r.issues.length === 0 ? (
                <span key="i" className="font-semibold text-eucalypt-700">
                  OK
                </span>
              ) : (
                <ul key="i" className="space-y-0.5 text-xs font-semibold text-ochre-700">
                  {r.issues.map((i) => (
                    <li key={i.code}>
                      {i.severity === "error" ? "Needs review: " : "Note: "}
                      {i.message}
                    </li>
                  ))}
                </ul>
              ),
            ],
          };
        })}
        empty={<EmptyState icon="check" title={issuesOnly ? "No flagged bookings" : "No paid bookings in this range"} description={issuesOnly ? "Every paid booking in this range reconciles." : undefined} />}
      />
      <Pagination className="mt-6" page={page} totalPages={pageCount(total)} hrefFor={(n) => listHref("/admin/payments/reconciliation", filters, { page: n })} />
    </>
  );
}
