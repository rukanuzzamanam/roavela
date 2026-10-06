import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AccountActions } from "@/components/admin/account-actions";
import { AdminHeader, AdminTable, dateTime, day, DemoBadge, Facts, InlineLink, money, Notice, Section, StatusPill } from "@/components/admin/admin-ui";
import { HistoryAndNotes } from "@/components/admin/history-and-notes";
import { Card } from "@/components/ui/feedback";
import { BOOKING_STATUS_LABELS } from "@/lib/booking-lifecycle";
import { requireAdmin } from "@/server/auth/admin-guard";
import { getAdminCustomer } from "@/server/services/admin/users";

export const metadata: Metadata = { title: "Customer" };

export default async function AdminCustomerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requireAdmin("admin:users:manage", `/admin/customers/${id}`);
  const data = await getAdminCustomer(id);
  if (!data) notFound();
  const { user: u, bookings, reviews, issues, history, notes } = data;
  const cancellations = bookings.filter((b) => b.cancelledAt);

  return (
    <>
      <AdminHeader
        eyebrow="Customer"
        title={u.name}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <StatusPill tone={u.status === "ACTIVE" ? "success" : "demo"}>Account {u.status.toLowerCase()}</StatusPill>
            {u.isDemo && <DemoBadge />}
          </span>
        }
      />
      <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="min-w-0 space-y-10">
          {issues.length > 0 && <Notice tone="warning">Needs review: {issues.join(" · ")}</Notice>}
          <Section id="bookings" title="Bookings" description="Most recent 50, excluding lapsed unpaid holds.">
            <AdminTable
              caption="Customer bookings"
              columns={[{ label: "Reference" }, { label: "Property" }, { label: "Stay" }, { label: "Status" }, { label: "Total" }]}
              rows={bookings.map((b) => ({
                key: b.reference,
                cells: [
                  <div key="r">
                    <InlineLink href={`/admin/bookings/${b.reference}`}>{b.reference}</InlineLink>
                    {b.isDemo && <DemoBadge />}
                  </div>,
                  <span key="p">{b.property.title}</span>,
                  <span key="s">
                    {day(b.checkIn)} → {day(b.checkOut)}
                  </span>,
                  <StatusPill key="st" tone={BOOKING_STATUS_LABELS[b.status].tone}>
                    {BOOKING_STATUS_LABELS[b.status].label}
                  </StatusPill>,
                  <span key="t" className="tabular-nums">{money(b.totalCents, b.currency)}</span>,
                ],
              }))}
              empty={<p className="text-sm text-mist">No bookings.</p>}
            />
          </Section>
          <Section id="cancellations" title="Cancellations">
            {cancellations.length === 0 ? (
              <p className="text-sm text-mist">No cancellations.</p>
            ) : (
              <ul className="divide-y divide-ink/8 rounded-2xl border border-ink/10 bg-white text-sm">
                {cancellations.map((b) => (
                  <li key={b.reference} className="p-3">
                    <InlineLink href={`/admin/bookings/${b.reference}`}>{b.reference}</InlineLink> · {dateTime(b.cancelledAt)} · {b.cancellationReason ?? "—"} · refund due {money(b.refundDueCents, b.currency)}
                  </li>
                ))}
              </ul>
            )}
          </Section>
          <Section id="reviews" title="Reviews written">
            {reviews.length === 0 ? (
              <p className="text-sm text-mist">No reviews.</p>
            ) : (
              <ul className="divide-y divide-ink/8 rounded-2xl border border-ink/10 bg-white text-sm">
                {reviews.map((r) => (
                  <li key={r.id} className="flex flex-wrap justify-between gap-2 p-3">
                    <span>
                      {r.property.title} · {r.overallRating}/5 · {day(r.createdAt)}
                    </span>
                    <StatusPill tone={r.status === "PUBLISHED" ? "success" : "warning"}>{r.status.toLowerCase()}</StatusPill>
                  </li>
                ))}
              </ul>
            )}
          </Section>
          <HistoryAndNotes history={history} notes={notes} targetType="User" targetId={u.id} path={`/admin/customers/${u.id}`} />
        </div>
        <aside className="space-y-4">
          <Card className="p-5">
            <h2 className="font-sans text-sm font-bold tracking-wider text-mist uppercase">Account</h2>
            <Facts
              className="mt-2 sm:grid-cols-1"
              items={[
                ["Email", <span key="e" className="break-all">{u.email}</span>],
                ["Phone", u.phone ?? "—"],
                ["Joined", day(u.createdAt)],
                ["Last login", dateTime(u.lastLoginAt)],
              ]}
            />
          </Card>
          <Card className="space-y-3 p-5">
            <h2 className="font-sans text-sm font-bold tracking-wider text-mist uppercase">Account status</h2>
            <AccountActions userId={u.id} status={u.status} version={u.updatedAt.toISOString()} kind="customer" />
          </Card>
        </aside>
      </div>
    </>
  );
}
