import type { Metadata } from "next";
import { AdminHeader, AdminTable, dateTime, InlineLink, ResultCount, SearchForm, StatusPill } from "@/components/admin/admin-ui";
import { EmptyState } from "@/components/ui/feedback";
import { Pagination } from "@/components/ui/pagination";
import { ADMIN_PAGE_SIZE, listHref, pageCount, parsePage, parseQuery, type RawParams } from "@/lib/admin/query";
import { requireAdmin } from "@/server/auth/admin-guard";
import { listAdminDestinations } from "@/server/services/admin/destinations";

export const metadata: Metadata = { title: "Destinations" };

export default async function AdminDestinationsPage({ searchParams }: { searchParams: Promise<RawParams> }) {
  await requireAdmin("admin:destinations:manage", "/admin/destinations");
  const sp = await searchParams;
  const q = parseQuery(sp);
  const page = parsePage(sp);
  const { total, rows } = await listAdminDestinations({ q, page });

  return (
    <>
      <AdminHeader eyebrow="Admin" title="Destinations" description="Editorial and SEO metadata for destination pages. Only published destinations get a public page." />
      <SearchForm action="/admin/destinations" q={q} placeholder="Name or slug" />
      <ResultCount total={total} page={page} pageSize={ADMIN_PAGE_SIZE} noun="destinations" />
      <AdminTable
        caption="Destinations"
        columns={[{ label: "Destination" }, { label: "Kind" }, { label: "Region" }, { label: "Live listings" }, { label: "Status" }, { label: "Updated" }]}
        rows={rows.map((d) => ({
          key: d.id,
          cells: [
            <div key="n">
              <InlineLink href={`/admin/destinations/${d.id}`}>{d.name}</InlineLink>
              <p className="text-xs text-mist">/{d.slug}</p>
            </div>,
            <span key="k">
              {d.kind.toLowerCase()}
              {d.isOrigin && <span className="block text-xs text-mist">trip origin</span>}
            </span>,
            <span key="r">{[d.adminArea, d.countryCode].filter(Boolean).join(", ")}</span>,
            <span key="l">{d._count.properties}</span>,
            <StatusPill key="s" tone={d.isPublished ? "success" : "neutral"}>
              {d.isPublished ? "Published" : "Not published"}
            </StatusPill>,
            <span key="u">{dateTime(d.updatedAt)}</span>,
          ],
        }))}
        empty={<EmptyState icon="map" title="No destinations match" />}
      />
      <Pagination className="mt-6" page={page} totalPages={pageCount(total)} hrefFor={(n) => listHref("/admin/destinations", { q }, { page: n })} />
    </>
  );
}
