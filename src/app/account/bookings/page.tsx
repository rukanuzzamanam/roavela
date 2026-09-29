import type { Metadata } from "next";
import Link from "next/link";
import { PropertyImage } from "@/components/property/property-image";
import { ButtonLink } from "@/components/ui/button";
import { Badge, EmptyState } from "@/components/ui/feedback";
import { BOOKING_STATUS_LABELS } from "@/lib/booking-lifecycle";
import { formatStayDate, todayInTimeZone } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { cn, pluralize } from "@/lib/utils";
import { requirePermission } from "@/server/auth/guards";
import { bookingTab, type BookingTab } from "@/lib/validation/booking";
import { listGuestBookings } from "@/server/services/bookings";

export const metadata: Metadata = { title: "Your trips", robots: { index: false } };

const TABS: { key: BookingTab; label: string; empty: string }[] = [
  { key: "upcoming", label: "Upcoming", empty: "No upcoming trips. Your next getaway is a search away." },
  { key: "past", label: "Past", empty: "No past trips yet." },
  { key: "cancelled", label: "Cancelled", empty: "No cancelled or expired bookings." },
];

type PageProps = { searchParams: Promise<{ tab?: string }> };

export default async function BookingsPage({ searchParams }: PageProps) {
  const user = await requirePermission("booking:create", "/account/bookings");
  const { tab: rawTab } = await searchParams;
  const tab: BookingTab = TABS.some((t) => t.key === rawTab) ? (rawTab as BookingTab) : "upcoming";

  const now = new Date();
  const all = await listGuestBookings(user.id);
  const grouped = Object.fromEntries(TABS.map((t) => [t.key, [] as typeof all])) as Record<BookingTab, typeof all>;
  for (const b of all) {
    const t = bookingTab(b, todayInTimeZone(b.property.timezone, now), now);
    if (t) grouped[t].push(b);
  }
  // Most relevant first: soonest upcoming, most recent past/cancelled.
  grouped.past.reverse();
  grouped.cancelled.reverse();
  const current = TABS.find((t) => t.key === tab)!;
  const rows = grouped[tab];

  return (
    <div className="container-page max-w-4xl py-10">
      <Link href="/account" className="text-sm font-semibold text-ink-soft hover:text-ink">
        ← Account
      </Link>
      <h1 className="mt-2 text-4xl">Your trips</h1>

      <nav aria-label="Trip filters" className="mt-6 flex gap-1 overflow-x-auto">
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={`/account/bookings?tab=${t.key}`}
            aria-current={t.key === tab ? "page" : undefined}
            className={cn(
              "inline-flex min-h-10 shrink-0 items-center gap-2 rounded-full px-4 text-sm font-semibold",
              t.key === tab ? "bg-eucalypt-700 text-white" : "text-ink-soft hover:bg-ink/5",
            )}
          >
            {t.label}
            <span className={cn("rounded-full px-1.5 text-xs", t.key === tab ? "bg-white/20" : "bg-sand-100")}>{grouped[t.key].length}</span>
          </Link>
        ))}
      </nav>

      <div className="mt-6">
        {rows.length === 0 ? (
          <EmptyState icon="calendar" title={`${current.label}: nothing here`} description={current.empty} action={<ButtonLink href="/search">Find a stay</ButtonLink>} />
        ) : (
          <ul className="space-y-3">
            {rows.map((b) => {
              const status = BOOKING_STATUS_LABELS[b.status];
              const href = b.status === "PENDING" ? `/checkout/${b.reference}` : `/account/bookings/${b.reference}`;
              return (
                <li key={b.id}>
                  <Link href={href} className="flex gap-4 rounded-2xl border border-ink/10 bg-white p-3 hover:border-eucalypt-600 sm:p-4">
                    <PropertyImage src={b.property.images[0]?.url ?? null} alt="" sizes="6rem" className="aspect-square w-20 shrink-0 rounded-xl sm:w-24" />
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold">{b.property.title}</p>
                      <p className="text-sm text-mist">
                        {formatStayDate(b.checkIn)} → {formatStayDate(b.checkOut)} · {pluralize(b.adults + b.children, "guest")}
                      </p>
                      <p className="text-sm text-mist">
                        Ref <span className="font-mono">{b.reference}</span> · {formatMoney(b.totalCents, b.currency, { showCents: true })} {b.currency}
                      </p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        <Badge tone={status.tone}>{status.label}</Badge>
                        {b.isDemo && <Badge tone="demo">Demo data</Badge>}
                      </div>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
