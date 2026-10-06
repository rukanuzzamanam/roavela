import type { Metadata } from "next";
import { AdminHeader, AdminTable, day, DemoBadge, FilterTabs, InlineLink, ResultCount, SearchForm, StatusPill } from "@/components/admin/admin-ui";
import { EmptyState } from "@/components/ui/feedback";
import { Pagination } from "@/components/ui/pagination";
import { ADMIN_PAGE_SIZE, listHref, oneOf, pageCount, parsePage, parseQuery, type RawParams } from "@/lib/admin/query";
import { requireAdmin } from "@/server/auth/admin-guard";
import { listHosts } from "@/server/services/admin/users";

export const metadata: Metadata = { title: "Hosts" };

const STATUSES = ["ACTIVE", "SUSPENDED"] as const;

export default async function AdminHostsPage({ searchParams }: { searchParams: Promise<RawParams> }) {
  await requireAdmin("admin:users:manage", "/admin/hosts");
  const sp = await searchParams;
  const status = oneOf(sp, "status", STATUSES);
  const q = parseQuery(sp);
  const page = parsePage(sp);
  const { total, rows } = await listHosts({ q, status, page });

  return (
    <>
      <AdminHeader eyebrow="Admin" title="Hosts" />
      <FilterTabs
        label="Account status"
        items={[
          { href: listHref("/admin/hosts", { q }), label: "All", active: !status },
          { href: listHref("/admin/hosts", { q, status: "ACTIVE" }), label: "Active", active: status === "ACTIVE" },
          { href: listHref("/admin/hosts", { q, status: "SUSPENDED" }), label: "Suspended", active: status === "SUSPENDED" },
        ]}
      />
      <SearchForm action="/admin/hosts" q={q} placeholder="Host name, display name or email" hidden={{ status }} />
      <ResultCount total={total} page={page} pageSize={ADMIN_PAGE_SIZE} noun="hosts" />
      <AdminTable
        caption="Hosts"
        columns={[{ label: "Host" }, { label: "Account" }, { label: "Onboarding" }, { label: "Listings (live)" }, { label: "Bookings" }, { label: "Compliance issues" }, { label: "Joined" }]}
        rows={rows.map((h) => ({
          key: h.id,
          cells: [
            <div key="n">
              <InlineLink href={`/admin/hosts/${h.id}`}>{h.hostProfile?.displayName ?? h.name}</InlineLink>
              <p className="text-xs text-mist">{h.name}</p>
              {h.isDemo && <DemoBadge />}
            </div>,
            <StatusPill key="s" tone={h.status === "ACTIVE" ? "success" : "demo"}>
              {h.status === "ACTIVE" ? "Active" : "Suspended"}
            </StatusPill>,
            <span key="o">{h.hostProfile?.onboardingStatus.replaceAll("_", " ").toLowerCase() ?? "not started"}</span>,
            <span key="l">
              {h.propertyCount} ({h.publishedCount} live)
            </span>,
            <span key="b">{h.bookingCount}</span>,
            <span key="c" className={h.complianceIssues ? "font-semibold text-ochre-700" : "text-mist"}>
              {h.complianceIssues ? `${h.complianceIssues} need review` : "None"}
            </span>,
            <span key="j">{day(h.createdAt)}</span>,
          ],
        }))}
        empty={<EmptyState icon="user" title="No hosts match" />}
      />
      <Pagination className="mt-6" page={page} totalPages={pageCount(total)} hrefFor={(n) => listHref("/admin/hosts", { q, status }, { page: n })} />
    </>
  );
}
