import type { Metadata } from "next";
import { AdminHeader, AdminTable, day, DemoBadge, FilterTabs, InlineLink, ResultCount, SearchForm, StatusPill } from "@/components/admin/admin-ui";
import { EmptyState } from "@/components/ui/feedback";
import { Pagination } from "@/components/ui/pagination";
import { ADMIN_PAGE_SIZE, listHref, oneOf, pageCount, parsePage, parseQuery, type RawParams } from "@/lib/admin/query";
import { requireAdmin } from "@/server/auth/admin-guard";
import { listCustomers } from "@/server/services/admin/users";

export const metadata: Metadata = { title: "Customers" };

const STATUSES = ["ACTIVE", "SUSPENDED"] as const;

export default async function AdminCustomersPage({ searchParams }: { searchParams: Promise<RawParams> }) {
  await requireAdmin("admin:users:manage", "/admin/customers");
  const sp = await searchParams;
  const status = oneOf(sp, "status", STATUSES);
  const q = parseQuery(sp);
  const page = parsePage(sp);
  const { total, rows } = await listCustomers({ q, status, page });

  return (
    <>
      <AdminHeader eyebrow="Admin" title="Customers" description="Traveller accounts. Hosts who also travel are listed under Hosts." />
      <FilterTabs
        label="Account status"
        items={[
          { href: listHref("/admin/customers", { q }), label: "All", active: !status },
          { href: listHref("/admin/customers", { q, status: "ACTIVE" }), label: "Active", active: status === "ACTIVE" },
          { href: listHref("/admin/customers", { q, status: "SUSPENDED" }), label: "Suspended", active: status === "SUSPENDED" },
        ]}
      />
      <SearchForm action="/admin/customers" q={q} placeholder="Name or email" hidden={{ status }} />
      <ResultCount total={total} page={page} pageSize={ADMIN_PAGE_SIZE} noun="customers" />
      <AdminTable
        caption="Customers"
        columns={[{ label: "Name" }, { label: "Email" }, { label: "Bookings" }, { label: "Account" }, { label: "Joined" }]}
        rows={rows.map((c) => ({
          key: c.id,
          cells: [
            <div key="n">
              <InlineLink href={`/admin/customers/${c.id}`}>{c.name}</InlineLink>
              {c.isDemo && <DemoBadge />}
            </div>,
            <span key="e" className="break-all">{c.email}</span>,
            <span key="b">{c._count.bookings}</span>,
            <StatusPill key="s" tone={c.status === "ACTIVE" ? "success" : "demo"}>
              {c.status === "ACTIVE" ? "Active" : "Suspended"}
            </StatusPill>,
            <span key="j">{day(c.createdAt)}</span>,
          ],
        }))}
        empty={<EmptyState icon="users" title="No customers match" />}
      />
      <Pagination className="mt-6" page={page} totalPages={pageCount(total)} hrefFor={(n) => listHref("/admin/customers", { q, status }, { page: n })} />
    </>
  );
}
