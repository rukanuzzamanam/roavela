import type { Metadata } from "next";
import { AdminHeader, AdminTable, dateTime, day, FilterTabs, InlineLink, Notice, ResultCount, SearchForm, StatusPill } from "@/components/admin/admin-ui";
import { EmptyState } from "@/components/ui/feedback";
import { Pagination } from "@/components/ui/pagination";
import { COMPLIANCE_STATUS_LABELS, COMPLIANCE_TYPE_LABELS } from "@/lib/admin/compliance";
import { ADMIN_PAGE_SIZE, listHref, oneOf, pageCount, parsePage, parseQuery, type RawParams } from "@/lib/admin/query";
import { requireAdmin } from "@/server/auth/admin-guard";
import { COMPLIANCE_FILTER_LABELS, COMPLIANCE_FILTERS, listComplianceQueue } from "@/server/services/admin/compliance";

export const metadata: Metadata = { title: "Compliance" };

export default async function AdminCompliancePage({ searchParams }: { searchParams: Promise<RawParams> }) {
  await requireAdmin("admin:compliance:review", "/admin/compliance");
  const sp = await searchParams;
  const filter = oneOf(sp, "filter", COMPLIANCE_FILTERS) ?? "pending";
  const q = parseQuery(sp);
  const page = parsePage(sp);
  const { total, rows } = await listComplianceQueue({ filter, q, page });

  return (
    <>
      <AdminHeader eyebrow="Admin" title="Compliance review" description="Short-term-rental registration, insurance, authority to list and local-rules acknowledgements provided by hosts." />
      <div className="mb-4">
        <Notice>Reviewing a record means an admin checked the information the host provided. Roavela does not verify registrations with government registers, and a reviewed record is not a legal certification.</Notice>
      </div>
      <FilterTabs label="Compliance status" items={COMPLIANCE_FILTERS.map((f) => ({ href: listHref("/admin/compliance", { q }, { filter: f }), label: COMPLIANCE_FILTER_LABELS[f], active: f === filter }))} />
      <SearchForm action="/admin/compliance" q={q} placeholder="STRA/registration number, listing title, host, jurisdiction (e.g. AU-NSW)" hidden={{ filter }} />
      <ResultCount total={total} page={page} pageSize={ADMIN_PAGE_SIZE} noun="records" />
      <AdminTable
        caption="Compliance records"
        columns={[{ label: "Listing" }, { label: "Requirement" }, { label: "Status" }, { label: "Reference / expiry" }, { label: "Flags" }, { label: "Submitted" }]}
        rows={rows.map((d) => ({
          key: d.id,
          cells: [
            <div key="l">
              {d.property ? <InlineLink href={`/admin/properties/${d.property.id}#compliance`}>{d.property.title}</InlineLink> : "—"}
              <p className="text-xs text-mist">
                {d.host.displayName} · {d.jurisdiction}
              </p>
            </div>,
            <span key="t">
              {COMPLIANCE_TYPE_LABELS[d.type]}
              {d.hasFile && <span className="block text-xs text-mist">Document on file</span>}
            </span>,
            <StatusPill key="s" tone={COMPLIANCE_STATUS_LABELS[d.status].tone}>
              {COMPLIANCE_STATUS_LABELS[d.status].label}
            </StatusPill>,
            <span key="r">
              {d.referenceNumber ?? "—"}
              {d.expiresAt && <span className="block text-xs text-mist">Expires {day(d.expiresAt)}</span>}
            </span>,
            <span key="f" className={d.flags.length ? "font-semibold text-ochre-700" : "text-mist"}>
              {d.flags.length ? d.flags.map((f) => f.label).join(" · ") : "None"}
            </span>,
            <span key="d">{dateTime(d.submittedAt)}</span>,
          ],
        }))}
        empty={<EmptyState icon="shield" title="No compliance records here" description={filter === "pending" ? "Nothing is waiting for compliance review." : undefined} />}
      />
      <Pagination className="mt-6" page={page} totalPages={pageCount(total)} hrefFor={(p) => listHref("/admin/compliance", { filter, q }, { page: p })} />
    </>
  );
}
