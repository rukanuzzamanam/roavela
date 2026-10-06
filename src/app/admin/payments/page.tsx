import type { Metadata } from "next";
import { AdminHeader, AdminTable, dateTime, DemoBadge, InlineLink, money, Notice, ResultCount, SearchForm, selectClasses, StatusPill, TestModeBadge } from "@/components/admin/admin-ui";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/feedback";
import { Pagination } from "@/components/ui/pagination";
import { ADMIN_PAGE_SIZE, listHref, oneOf, pageCount, parsePage, parseQuery, type RawParams } from "@/lib/admin/query";
import { requireAdmin } from "@/server/auth/admin-guard";
import { listAdminPayments, PAYMENT_STATUSES } from "@/server/services/admin/bookings";

export const metadata: Metadata = { title: "Payments" };

const PROVIDERS = ["stripe", "mock"] as const;

export default async function AdminPaymentsPage({ searchParams }: { searchParams: Promise<RawParams> }) {
  await requireAdmin("admin:finance:view", "/admin/payments");
  const sp = await searchParams;
  const status = oneOf(sp, "status", PAYMENT_STATUSES);
  const provider = oneOf(sp, "provider", PROVIDERS);
  const q = parseQuery(sp);
  const page = parsePage(sp);
  const { total, rows } = await listAdminPayments({ q, status, provider, page });

  return (
    <>
      <AdminHeader
        eyebrow="Admin"
        title="Payments"
        description="Financial oversight of payment records. Stripe remains the authority on payment state; Roavela records what verified webhooks report."
        actions={<ButtonLink href="/admin/payments/reconciliation" variant="outline">Reconciliation</ButtonLink>}
      />
      <div className="mb-4">
        <Notice>
          <span className="inline-flex flex-wrap items-center gap-2">
            <TestModeBadge /> All payments are Stripe TEST MODE (or the development simulator). Card details never reach Roavela.
          </span>
        </Notice>
      </div>
      <SearchForm action="/admin/payments" q={q} placeholder="Payment intent id, payment id or booking reference">
        <label className="text-sm">
          <span className="block font-semibold text-ink-soft">Status</span>
          <select name="status" defaultValue={status ?? ""} className={selectClasses()}>
            <option value="">Any</option>
            {PAYMENT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s.replaceAll("_", " ").toLowerCase()}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          <span className="block font-semibold text-ink-soft">Provider</span>
          <select name="provider" defaultValue={provider ?? ""} className={selectClasses()}>
            <option value="">Any</option>
            <option value="stripe">Stripe (test)</option>
            <option value="mock">Development simulator</option>
          </select>
        </label>
      </SearchForm>
      <ResultCount total={total} page={page} pageSize={ADMIN_PAGE_SIZE} noun="payments" />
      <AdminTable
        caption="Payments"
        columns={[{ label: "Payment" }, { label: "Booking" }, { label: "Status" }, { label: "Amount" }, { label: "Refunded" }, { label: "Created / updated" }]}
        rows={rows.map((p) => ({
          key: p.id,
          cells: [
            <div key="p">
              <code className="text-xs break-all">{p.providerPaymentId ?? p.id}</code>
              <p className="text-xs text-mist">{p.provider === "mock" ? "Development simulator" : "Stripe (test)"}</p>
            </div>,
            <div key="b">
              <InlineLink href={`/admin/bookings/${p.booking.reference}`}>{p.booking.reference}</InlineLink>
              {p.booking.isDemo && <DemoBadge />}
            </div>,
            <div key="s" className="space-y-1">
              <StatusPill tone={p.status === "SUCCEEDED" ? "success" : p.status === "FAILED" ? "demo" : p.status === "REFUNDED" || p.status === "PARTIALLY_REFUNDED" ? "neutral" : "warning"}>{p.status.replaceAll("_", " ").toLowerCase()}</StatusPill>
              {p.failureCode && <p className="text-xs text-mist">{p.failureCode}</p>}
            </div>,
            <span key="a" className="tabular-nums">
              {money(p.amountCents, p.currency)} {p.currency}
            </span>,
            <span key="r" className="tabular-nums">
              {money(p.refundedCents, p.currency)}
              {p.refunds.some((r) => r.status === "PENDING") && <span className="block text-xs text-mist">refund pending</span>}
              {p.refunds.some((r) => r.status === "FAILED") && <span className="block text-xs text-red-800">refund failed</span>}
            </span>,
            <span key="d" className="text-xs">
              {dateTime(p.createdAt)}
              <br />
              {dateTime(p.updatedAt)}
            </span>,
          ],
        }))}
        empty={<EmptyState icon="list" title="No payments match" />}
      />
      <Pagination className="mt-6" page={page} totalPages={pageCount(total)} hrefFor={(n) => listHref("/admin/payments", { q, status, provider }, { page: n })} />
    </>
  );
}
