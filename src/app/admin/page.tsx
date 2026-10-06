import type { Metadata } from "next";
import Link from "next/link";
import { AdminHeader, MetricCard, money, Notice, Section, selectClasses, TestModeBadge } from "@/components/admin/admin-ui";
import { EmptyState } from "@/components/ui/feedback";
import { Icon } from "@/components/ui/icons";
import { resolveRange } from "@/lib/admin/ranges";
import { first, type RawParams } from "@/lib/admin/query";
import { requireAdmin } from "@/server/auth/admin-guard";
import { getAttentionItems, getDashboardMetrics } from "@/server/services/admin/metrics";

export const metadata: Metadata = { title: "Overview" };

export default async function AdminOverviewPage({ searchParams }: { searchParams: Promise<RawParams> }) {
  await requireAdmin("admin:portal", "/admin");
  const sp = await searchParams;
  const range = resolveRange({ range: first(sp, "range"), from: first(sp, "from"), to: first(sp, "to") });
  const [m, attention] = await Promise.all([getDashboardMetrics(range), getAttentionItems()]);
  const c = m.money.currency;

  return (
    <>
      <AdminHeader eyebrow="Admin" title="Marketplace overview" description="Live figures from the database. Nothing here is estimated or sample data." />

      <Section id="attention" title="Needs attention" className="mb-10">
        {attention.length === 0 ? (
          <EmptyState icon="check" title="Nothing needs attention" description="No listings, compliance records or refunds are waiting on an admin." />
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2">
            {attention.map((a) => (
              <li key={a.key}>
                <Link href={a.href} className="flex min-h-14 items-center justify-between gap-3 rounded-2xl border border-ochre-200 bg-white px-4 py-3 hover:border-ochre-400">
                  <span>
                    <strong className="tabular-nums">{a.count}</strong> {a.label}
                  </span>
                  <Icon name="chevronRight" size={18} className="shrink-0 text-mist" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section id="marketplace" title="Marketplace now" className="mb-10">
        <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <MetricCard label="Total users" value={m.marketplace.totalUsers.toLocaleString("en-AU")} hint={`${m.marketplace.customers.toLocaleString("en-AU")} customers`} />
          <MetricCard label="Active hosts" value={m.marketplace.activeHosts} hint="Active account with a live listing" />
          <MetricCard label="Published properties" value={m.marketplace.publishedProperties} />
          <MetricCard label="Awaiting review" value={m.marketplace.awaitingReview + m.marketplace.underReview} hint={`${m.marketplace.underReview} under review`} tone={m.marketplace.awaitingReview ? "attention" : undefined} />
          <MetricCard label="Compliance to review" value={m.marketplace.complianceToReview} tone={m.marketplace.complianceToReview ? "attention" : undefined} />
        </dl>
      </Section>

      <Section
        id="performance"
        title="Bookings & revenue"
        description={`${m.range.label} (${m.range.firstDay} – ${m.range.lastDay}, Sydney time). Bookings are counted when payment confirmed them.`}
        actions={
          <form method="get" className="flex flex-wrap items-end gap-2" aria-label="Date range">
            <label className="text-sm">
              <span className="block font-semibold text-ink-soft">Range</span>
              <select name="range" defaultValue={m.range.preset} className={selectClasses()}>
                <option value="7d">Last 7 days</option>
                <option value="30d">Last 30 days</option>
                <option value="this_month">This month</option>
                <option value="prev_month">Previous month</option>
                <option value="custom">Custom (below)</option>
              </select>
            </label>
            <label className="text-sm">
              <span className="block font-semibold text-ink-soft">From</span>
              <input type="date" name="from" defaultValue={m.range.preset === "custom" ? m.range.firstDay : undefined} className={selectClasses()} />
            </label>
            <label className="text-sm">
              <span className="block font-semibold text-ink-soft">To</span>
              <input type="date" name="to" defaultValue={m.range.preset === "custom" ? m.range.lastDay : undefined} className={selectClasses()} />
            </label>
            <button type="submit" className="h-11 rounded-full bg-eucalypt-700 px-5 text-sm font-semibold text-white hover:bg-eucalypt-800">
              Apply
            </button>
          </form>
        }
      >
        {m.range.invalid && (
          <div className="mb-3">
            <Notice tone="warning">That custom range wasn&apos;t valid (dates must be in order, not in the future, and at most 366 days), so the last 30 days are shown.</Notice>
          </div>
        )}
        <div className="mb-3 flex flex-wrap items-center gap-2 text-sm text-mist">
          <TestModeBadge /> Payments run in Stripe test mode — these amounts are not real money.
          {m.bookings.demoExcluded > 0 && <span>{m.bookings.demoExcluded} demo booking(s) excluded.</span>}
        </div>
        <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <MetricCard label="Confirmed bookings" value={m.bookings.confirmed} />
          <MetricCard label="Gross booking value" value={money(m.money.gbvCents, c)} hint="Guest totals, before refunds" />
          <MetricCard label="Platform gross revenue" value={money(m.money.platformGrossCents, c)} hint="Fees + commission. Not profit." />
          <MetricCard label="Refunds confirmed" value={money(m.money.refundsCents, c)} />
          <MetricCard label="Cancelled bookings" value={m.bookings.cancelled} />
          <MetricCard label="Cancellation rate" value={m.bookings.cancellationRateBps === null ? "—" : `${(m.bookings.cancellationRateBps / 100).toFixed(1)}%`} />
          <MetricCard label="Average booking value" value={money(m.money.averageBookingCents, c)} />
        </dl>
        {m.money.otherCurrencies.length > 0 && <p className="mt-3 text-sm text-mist">Bookings in {m.money.otherCurrencies.join(", ")} are counted but not added to {c} totals.</p>}

        <details className="mt-6 rounded-2xl border border-ink/10 bg-white p-4 text-sm">
          <summary className="cursor-pointer font-semibold">How these figures are calculated</summary>
          <ul className="mt-3 list-disc space-y-1.5 pl-5 text-ink-soft">
            <li>
              <strong>Confirmed bookings</strong>: bookings whose payment was confirmed in the range, whatever happened to them later. Demo bookings are excluded.
            </li>
            <li>
              <strong>Gross booking value</strong> = the guest totals of those bookings, before any refunds.
            </li>
            <li>
              <strong>Platform gross revenue</strong> = guest service fees + host commissions of those bookings, minus that revenue on bookings refunded in full ({money(m.money.platformReversedCents, c)} this range). Partial refunds aren&apos;t split between host and platform yet. Payment-processing costs aren&apos;t deducted, so this is <em>not</em> profit.
            </li>
            <li>
              <strong>Refunds confirmed</strong> = refunds requested in the range that the payment provider has confirmed.
            </li>
            <li>
              <strong>Cancellation rate</strong> = those bookings that are now cancelled or refunded ÷ confirmed bookings.
            </li>
          </ul>
        </details>
      </Section>
    </>
  );
}
