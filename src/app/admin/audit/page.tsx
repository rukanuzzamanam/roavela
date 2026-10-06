import type { Metadata } from "next";
import { AdminHeader, AdminTable, dateTime, FilterTabs, InlineLink, Notice, ResultCount, SearchForm } from "@/components/admin/admin-ui";
import { EmptyState } from "@/components/ui/feedback";
import { Pagination } from "@/components/ui/pagination";
import { actionLabel } from "@/lib/admin/labels";
import { ADMIN_PAGE_SIZE, first, listHref, oneOf, pageCount, parsePage, parseQuery, type RawParams } from "@/lib/admin/query";
import { requireAdmin } from "@/server/auth/admin-guard";
import { AUDIT_SOURCES, listAuditEntries } from "@/server/services/admin/history";

export const metadata: Metadata = { title: "Audit log" };

const TARGET_TYPES = ["Property", "User", "Booking", "Review", "Destination", "PlatformFeeSchedule", "HostProfile"] as const;

function targetHref(type: string, id: string): string | null {
  switch (type) {
    case "Property":
      return `/admin/properties/${id}`;
    case "Destination":
      return `/admin/destinations/${id}`;
    default:
      return null;
  }
}

/** Safe metadata preview: identifiers/statuses/amounts only are ever stored, shown compactly. */
function metaPreview(metadata: unknown): string {
  if (!metadata || typeof metadata !== "object") return "";
  return Object.entries(metadata as Record<string, unknown>)
    .filter(([, v]) => v !== null && v !== undefined && typeof v !== "object")
    .slice(0, 5)
    .map(([k, v]) => `${k}: ${String(v)}`)
    .join(" · ");
}

export default async function AdminAuditPage({ searchParams }: { searchParams: Promise<RawParams> }) {
  await requireAdmin("admin:audit:view", "/admin/audit");
  const sp = await searchParams;
  const source = oneOf(sp, "source", AUDIT_SOURCES) ?? "admin";
  const targetType = oneOf(sp, "type", TARGET_TYPES);
  const action = parseQuery(sp, "q");
  const targetIdRaw = first(sp, "target");
  const targetId = targetIdRaw && /^[A-Za-z0-9_-]{1,64}$/.test(targetIdRaw) ? targetIdRaw : undefined;
  const page = parsePage(sp);
  const { total, rows } = await listAuditEntries({ source, action, targetType, targetId, page });
  const filters = { source, type: targetType, q: action, target: targetId };

  return (
    <>
      <AdminHeader eyebrow="Admin" title="Audit log" description="Append-only operational records. Entries can't be edited or deleted from Roavela." />
      <div className="mb-4">
        <Notice>Admin decisions are recorded with the actor, target, reason and safe metadata (identifiers, statuses and amounts — never secrets, card data or document contents).</Notice>
      </div>
      <FilterTabs
        label="Audit source"
        items={[
          { href: listHref("/admin/audit", { ...filters, source: "admin" }, { page: 1 }), label: "Admin decisions", active: source === "admin" },
          { href: listHref("/admin/audit", { ...filters, source: "user" }, { page: 1 }), label: "Host & customer activity", active: source === "user" },
        ]}
      />
      <SearchForm action="/admin/audit" q={action} placeholder="Action prefix, e.g. property. or refund.executed" hidden={{ source, target: targetId }}>
        <label className="text-sm">
          <span className="block font-semibold text-ink-soft">Target type</span>
          <select name="type" defaultValue={targetType ?? ""} className="h-11 rounded-xl border border-ink/15 bg-white px-3 text-sm">
            <option value="">Any</option>
            {TARGET_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
      </SearchForm>
      <ResultCount total={total} page={page} pageSize={ADMIN_PAGE_SIZE} noun="entries" />
      <AdminTable
        caption="Audit entries"
        columns={[{ label: "When" }, { label: "Actor" }, { label: "Action" }, { label: "Target" }, { label: "Reason / details" }]}
        rows={rows.map((r) => {
          const href = targetHref(r.targetType, r.targetId);
          return {
            key: r.id,
            cells: [
              <span key="w" className="text-xs">{dateTime(r.createdAt)}</span>,
              <span key="a">{r.actorName}</span>,
              <span key="ac">
                {actionLabel(r.action)}
                <code className="block text-xs text-mist">{r.action}</code>
              </span>,
              <span key="t" className="text-xs">
                {r.targetType} {href ? <InlineLink href={href}>{r.targetId}</InlineLink> : <code>{r.targetId}</code>}
              </span>,
              <span key="r" className="text-xs">
                {r.reason && <span className="block text-sm">{r.reason}</span>}
                <span className="text-mist">{metaPreview(r.metadata)}</span>
              </span>,
            ],
          };
        })}
        empty={<EmptyState icon="clock" title="No audit entries match" />}
      />
      <Pagination className="mt-6" page={page} totalPages={pageCount(total)} hrefFor={(n) => listHref("/admin/audit", filters, { page: n })} />
    </>
  );
}
