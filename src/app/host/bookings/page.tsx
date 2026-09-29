import type { Metadata } from "next";
import Link from "next/link";
import { HostShell } from "@/components/host/host-ui";
import { Badge, Card, EmptyState } from "@/components/ui/feedback";
import { BOOKING_STATUS_LABELS } from "@/lib/booking-lifecycle";
import { formatStayDate } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { pluralize } from "@/lib/utils";
import { requireHost } from "@/server/auth/host-guard";
import { listHostBookings } from "@/server/services/bookings";

export const metadata: Metadata = { title: "Bookings", robots: { index: false } };

/** Bookings on the host's own listings only (ownership is part of the query). */
export default async function HostBookingsPage() {
  const user = await requireHost("/host/bookings");
  const bookings = await listHostBookings(user.id);
  const now = new Date();
  const upcoming = bookings.filter((b) => b.status === "CONFIRMED" && b.checkOut > now);
  const other = bookings.filter((b) => !upcoming.includes(b)).reverse();

  return (
    <HostShell current="/host/bookings" eyebrow="Host portal" title="Bookings">
      <p className="-mt-4 mb-8 max-w-2xl text-ink-soft">
        Proceeds are your gross amount per booking: accommodation − Roavela commission + the full cleaning fee, before payment-processing costs. Payouts
        aren&apos;t enabled yet — payments currently run in Stripe test mode.
      </p>
      {bookings.length === 0 ? (
        <EmptyState icon="calendar" title="No bookings yet" description="When a guest books and pays for one of your live listings, it will appear here." />
      ) : (
        <div className="space-y-10">
          <BookingList title="Upcoming" rows={upcoming} empty="No upcoming stays." />
          <BookingList title="Past and cancelled" rows={other} empty="Nothing here yet." />
        </div>
      )}
    </HostShell>
  );
}

function BookingList({ title, rows, empty }: { title: string; rows: Awaited<ReturnType<typeof listHostBookings>>; empty: string }) {
  return (
    <section aria-label={title}>
      <h2 className="mb-4 text-2xl">{title}</h2>
      {rows.length === 0 ? (
        <p className="text-mist">{empty}</p>
      ) : (
        <Card className="divide-y divide-ink/10">
          {rows.map((b) => {
            const status = BOOKING_STATUS_LABELS[b.status];
            return (
              <Link key={b.id} href={`/host/bookings/${b.reference}`} className="flex flex-wrap items-center justify-between gap-3 p-4 hover:bg-sand-50">
                <div className="min-w-0">
                  <p className="font-semibold">{b.property.title}</p>
                  <p className="text-sm text-mist">
                    {formatStayDate(b.checkIn)} → {formatStayDate(b.checkOut)} · {b.guestFirstName} · {pluralize(b.adults + b.children, "guest")}
                  </p>
                  <p className="font-mono text-xs text-mist">{b.reference}</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-right">
                    <span className="block text-xs text-mist">Your proceeds</span>
                    <span className="font-semibold tabular-nums">{formatMoney(b.hostPayoutCents, b.currency, { showCents: true })}</span>
                  </span>
                  <Badge tone={status.tone}>{status.label}</Badge>
                  {b.isDemo && <Badge tone="demo">Demo data</Badge>}
                </div>
              </Link>
            );
          })}
        </Card>
      )}
    </section>
  );
}
