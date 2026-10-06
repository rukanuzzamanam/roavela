import type { Metadata } from "next";
import { AdminHeader, AdminTable, dateTime, DemoBadge, FilterTabs, InlineLink, ResultCount, SearchForm, StatusPill } from "@/components/admin/admin-ui";
import { EmptyState } from "@/components/ui/feedback";
import { Pagination } from "@/components/ui/pagination";
import { STATUS_LABELS } from "@/lib/listing-lifecycle";
import { ADMIN_PAGE_SIZE, listHref, oneOf, pageCount, parsePage, parseQuery, type RawParams } from "@/lib/admin/query";
import { requireAdmin } from "@/server/auth/admin-guard";
import { listAdminProperties, PROPERTY_FILTER_LABELS, PROPERTY_FILTERS } from "@/server/services/admin/properties";

export const metadata: Metadata = { title: "Properties" };

export default async function AdminPropertiesPage({ searchParams }: { searchParams: Promise<RawParams> }) {
  await requireAdmin("admin:properties:moderate", "/admin/properties");
  const sp = await searchParams;
  const filter = oneOf(sp, "filter", PROPERTY_FILTERS) ?? "pending";
  const q = parseQuery(sp);
  const page = parsePage(sp);
  const { total, rows } = await listAdminProperties({ filter, q, page });
  const filters = { filter, q };

  return (
    <>
      <AdminHeader eyebrow="Admin" title="Properties" description="Review submitted listings and manage live ones. Review queues show the oldest submission first." />
      <FilterTabs label="Listing status" items={PROPERTY_FILTERS.map((f) => ({ href: listHref("/admin/properties", { q }, { filter: f }), label: PROPERTY_FILTER_LABELS[f], active: f === filter }))} />
      <SearchForm action="/admin/properties" q={q} placeholder="Title, host name or email, STRA number, listing id" hidden={{ filter }} />
      <ResultCount total={total} page={page} pageSize={ADMIN_PAGE_SIZE} noun="listings" />
      <AdminTable
        caption={`${PROPERTY_FILTER_LABELS[filter]} listings`}
        columns={[{ label: "Listing" }, { label: "Host" }, { label: "Status" }, { label: "Submitted" }, { label: "Compliance" }]}
        rows={rows.map((p) => ({
          key: p.id,
          cells: [
            <div key="t" className="space-y-1">
              <InlineLink href={`/admin/properties/${p.id}`}>{p.title}</InlineLink>
              <p className="text-xs text-mist">{[p.locality, p.adminArea].filter(Boolean).join(", ") || "Location not set"}</p>
              {p.isDemo && <DemoBadge />}
            </div>,
            <div key="h">
              {p.host.displayName}
              {p.host.user.status === "SUSPENDED" && <p className="text-xs font-semibold text-red-800">Host suspended</p>}
            </div>,
            <div key="s" className="space-y-1">
              <StatusPill tone={STATUS_LABELS[p.status].tone}>{p.status === "PENDING_REVIEW" ? (p.reviewStartedAt ? "Under review" : "Pending review") : STATUS_LABELS[p.status].label}</StatusPill>
              {p.reviewStartedBy && <p className="text-xs text-mist">by {p.reviewStartedBy.name}</p>}
            </div>,
            <span key="d">{dateTime(p.submittedAt)}</span>,
            <span key="c">{p._count.compliance > 0 ? `${p._count.compliance} to review` : "—"}</span>,
          ],
        }))}
        empty={<EmptyState icon="list" title={filter === "pending" ? "No properties currently require review" : "No listings match"} description={q ? "Try a different search." : undefined} />}
      />
      <Pagination className="mt-6" page={page} totalPages={pageCount(total)} hrefFor={(p) => listHref("/admin/properties", filters, { page: p })} />
    </>
  );
}
