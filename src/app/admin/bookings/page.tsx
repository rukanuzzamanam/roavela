import type { Metadata } from "next";
import { AdminHeader, AdminTable, day, DemoBadge, InlineLink, money, ResultCount, SearchForm, selectClasses, StatusPill } from "@/components/admin/admin-ui";
import { EmptyState } from "@/components/ui/feedback";
import { Pagination } from "@/components/ui/pagination";
import { BOOKING_STATUS_LABELS } from "@/lib/booking-lifecycle";
import { isIsoDate } from "@/lib/dates";
import { ADMIN_PAGE_SIZE, first, listHref, oneOf, pageCount, parsePage, parseQuery, type RawParams } from "@/lib/admin/query";
import { requireAdmin } from "@/server/auth/admin-guard";
import { BOOKING_STATUSES, listAdminBookings, PAYMENT_STATUSES } from "@/server/services/admin/bookings";

export const metadata: Metadata = { title: "Bookings" };

export default async function AdminBookingsPage({ searchParams }: { searchParams: Promise<RawParams> }) {
  await requireAdmin("admin:bookings:view", "/admin/bookings");
  const sp = await searchParams;
  const status = oneOf(sp, "status", BOOKING_STATUSES);
  const paymentStatus = oneOf(sp, "payment", PAYMENT_STATUSES);
  const from = isIsoDate(first(sp, "from") ?? "") ? first(sp, "from") : undefined;
  const to = isIsoDate(first(sp, "to") ?? "") ? first(sp, "to") : undefined;
  const q = parseQuery(sp);
  const page = parsePage(sp);
  const { total, rows } = await listAdminBookings({ q, status, paymentStatus, from, to, page });
  const filters = { q, status, payment: paymentStatus, from, to };

  return (
    <>
      <AdminHeader eyebrow="Admin" title="Bookings" description="Every booking, including unpaid holds. Amounts are the booking's immutable price snapshot." />
      <SearchForm action="/admin/bookings" q={q} placeholder="Reference, customer name/email, property, host, payment id">
        <label className="text-sm">
          <span className="block font-semibold text-ink-soft">Booking status</span>
          <select name="status" defaultValue={status ?? ""} className={selectClasses()}>
            <option value="">Any</option>
            {BOOKING_STATUSES.map((s) => (
              <option key={s} value={s}>
                {BOOKING_STATUS_LABELS[s].label}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          <span className="block font-semibold text-ink-soft">Payment status</span>
          <select name="payment" defaultValue={paymentStatus ?? ""} className={selectClasses()}>
            <option value="">Any</option>
            {PAYMENT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s.replaceAll("_", " ").toLowerCase()}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          <span className="block font-semibold text-ink-soft">Check-in from</span>
          <input type="date" name="from" defaultValue={from} className={selectClasses()} />
        </label>
        <label className="text-sm">
          <span className="block font-semibold text-ink-soft">to</span>
          <input type="date" name="to" defaultValue={to} className={selectClasses()} />
        </label>
      </SearchForm>
      <ResultCount total={total} page={page} pageSize={ADMIN_PAGE_SIZE} noun="bookings" />
      <AdminTable
        caption="Bookings"
        columns={[{ label: "Reference" }, { label: "Property / host" }, { label: "Customer" }, { label: "Stay" }, { label: "Status" }, { label: "Total" }, { label: "Platform fees" }, { label: "Est. host proceeds" }]}
        rows={rows.map((b) => ({
          key: b.id,
          cells: [
            <div key="r">
              <InlineLink href={`/admin/bookings/${b.reference}`}>{b.reference}</InlineLink>
              <p className="text-xs text-mist">Created {day(b.createdAt)}</p>
              {b.isDemo && <DemoBadge />}
            </div>,
            <div key="p">
              {b.property.title}
              <p className="text-xs text-mist">{b.property.host.displayName}</p>
            </div>,
            <span key="c">{b.guest.name}</span>,
            <span key="s">
              {day(b.checkIn)} → {day(b.checkOut)}
              <span className="block text-xs text-mist">
                {b.nights} nights · {b.adults + b.children} guests
              </span>
            </span>,
            <div key="st" className="space-y-1">
              <StatusPill tone={BOOKING_STATUS_LABELS[b.status].tone}>{BOOKING_STATUS_LABELS[b.status].label}</StatusPill>
              <p className="text-xs text-mist">Payment: {b.payments.length ? b.payments.map((p) => p.status.replaceAll("_", " ").toLowerCase()).join(", ") : "none"}</p>
            </div>,
            <span key="t" className="tabular-nums">
              {money(b.totalCents, b.currency)}
            </span>,
            <span key="f" className="tabular-nums">
              {money(b.platformRevenueCents, b.currency)}
            </span>,
            <span key="h" className="tabular-nums">
              {money(b.hostPayoutCents, b.currency)}
            </span>,
          ],
        }))}
        empty={<EmptyState icon="calendar" title="No bookings match" description={q || status || paymentStatus || from || to ? "Try removing a filter." : "Bookings appear here once guests start checkout."} />}
      />
      <Pagination className="mt-6" page={page} totalPages={pageCount(total)} hrefFor={(p) => listHref("/admin/bookings", filters, { page: p })} />
    </>
  );
}
