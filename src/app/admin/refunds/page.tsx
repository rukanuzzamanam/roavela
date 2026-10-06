import type { Metadata } from "next";
import { AdminHeader, AdminTable, dateTime, DemoBadge, FilterTabs, InlineLink, money, Notice, ResultCount, StatusPill, TestModeBadge } from "@/components/admin/admin-ui";
import { EmptyState } from "@/components/ui/feedback";
import { Pagination } from "@/components/ui/pagination";
import { BOOKING_STATUS_LABELS } from "@/lib/booking-lifecycle";
import { ADMIN_PAGE_SIZE, listHref, oneOf, pageCount, parsePage, type RawParams } from "@/lib/admin/query";
import { requireAdmin } from "@/server/auth/admin-guard";
import { listRefundAttention, listRefundLedger, REFUND_VIEWS } from "@/server/services/admin/refunds";

export const metadata: Metadata = { title: "Refunds" };

export default async function AdminRefundsPage({ searchParams }: { searchParams: Promise<RawParams> }) {
  await requireAdmin("admin:refunds:manage", "/admin/refunds");
  const sp = await searchParams;
  const view = oneOf(sp, "view", REFUND_VIEWS) ?? "attention";
  const page = parsePage(sp);

  const header = (
    <>
      <AdminHeader eyebrow="Admin" title="Refunds" description="Refunds run through one idempotent pipeline: repeated clicks or retries can never refund twice, and nothing is marked refunded until the provider confirms it." />
      <div className="mb-4">
        <Notice>
          <span className="inline-flex flex-wrap items-center gap-2">
            <TestModeBadge /> Refunds are Stripe TEST MODE only. Open a booking to preview and execute a refund.
          </span>
        </Notice>
      </div>
      <FilterTabs
        label="Refund view"
        items={[
          { href: "/admin/refunds", label: "Needs action", active: view === "attention" },
          { href: "/admin/refunds?view=ledger", label: "Refund ledger", active: view === "ledger" },
        ]}
      />
    </>
  );

  if (view === "ledger") {
    const { total, rows } = await listRefundLedger(page);
    return (
      <>
        {header}
        <ResultCount total={total} page={page} pageSize={ADMIN_PAGE_SIZE} noun="refunds" />
        <AdminTable
          caption="Refund ledger"
          columns={[{ label: "Booking" }, { label: "Amount" }, { label: "Reason" }, { label: "Provider status" }, { label: "Requested" }]}
          rows={rows.map((r) => ({
            key: r.id,
            cells: [
              <InlineLink key="b" href={`/admin/bookings/${r.booking.reference}`}>
                {r.booking.reference}
              </InlineLink>,
              <span key="a" className="tabular-nums">{money(r.amountCents, r.currency)}</span>,
              <span key="r">
                {r.reason.replaceAll("_", " ")}
                {r.requestedBy && <span className="block text-xs text-mist">by {r.requestedBy.name}</span>}
              </span>,
              <div key="s" className="space-y-1">
                <StatusPill tone={r.status === "SUCCEEDED" ? "success" : r.status === "PENDING" ? "warning" : "demo"}>{r.status.toLowerCase()}</StatusPill>
                {r.providerRefundId && <code className="block text-xs">{r.providerRefundId}</code>}
                {r.failureCode && <p className="text-xs text-red-800">{r.failureCode}</p>}
              </div>,
              <span key="d" className="text-xs">
                {dateTime(r.createdAt)}
                {r.confirmedAt && <span className="block text-mist">confirmed {dateTime(r.confirmedAt)}</span>}
              </span>,
            ],
          }))}
          empty={<EmptyState icon="list" title="No refunds yet" />}
        />
        <Pagination className="mt-6" page={page} totalPages={pageCount(total)} hrefFor={(n) => listHref("/admin/refunds", { view: "ledger" }, { page: n })} />
      </>
    );
  }

  const { total, rows } = await listRefundAttention(page);
  return (
    <>
      {header}
      <ResultCount total={total} page={page} pageSize={ADMIN_PAGE_SIZE} noun="bookings" />
      <AdminTable
        caption="Bookings needing refund action"
        columns={[{ label: "Booking" }, { label: "Status" }, { label: "Refund due" }, { label: "Still owed" }, { label: "Latest refund" }, { label: "Cancelled" }]}
        rows={rows.map((b) => ({
          key: b.id,
          cells: [
            <div key="b">
              <InlineLink href={`/admin/bookings/${b.reference}`}>{b.reference}</InlineLink>
              <p className="text-xs text-mist">
                {b.property.title} · {b.guest.name}
              </p>
              {b.isDemo && <DemoBadge />}
            </div>,
            <StatusPill key="s" tone={BOOKING_STATUS_LABELS[b.status].tone}>
              {BOOKING_STATUS_LABELS[b.status].label}
            </StatusPill>,
            <span key="d" className="tabular-nums">{money(b.refundDueCents, b.currency)}</span>,
            <strong key="o" className="tabular-nums">{money(b.outstandingCents, b.currency)}</strong>,
            <span key="l">
              {b.latestRefund ? (
                <>
                  {b.latestRefund.status.toLowerCase()}
                  {b.latestRefund.failureCode && <span className="block text-xs text-red-800">{b.latestRefund.failureCode}</span>}
                </>
              ) : (
                "None requested"
              )}
            </span>,
            <span key="c">{dateTime(b.cancelledAt)}</span>,
          ],
        }))}
        empty={<EmptyState icon="check" title="No refunds need action" description="Every cancellation refund has been confirmed by the payment provider." />}
      />
      <Pagination className="mt-6" page={page} totalPages={pageCount(total)} hrefFor={(n) => listHref("/admin/refunds", {}, { page: n })} />
    </>
  );
}
