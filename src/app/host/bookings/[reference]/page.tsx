import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { HostShell } from "@/components/host/host-ui";
import { Badge, Card } from "@/components/ui/feedback";
import { CANCELLATION_COPY } from "@/config/policies";
import { BOOKING_STATUS_LABELS } from "@/lib/booking-lifecycle";
import { formatStayDate } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { pluralize } from "@/lib/utils";
import { requireHost } from "@/server/auth/host-guard";
import { getHostBooking } from "@/server/services/bookings";

export const metadata: Metadata = { title: "Booking", robots: { index: false } };

type PageProps = { params: Promise<{ reference: string }> };

/**
 * One booking on the host's own listing. Another host's reference is a 404. Guest data is minimal:
 * first name and party size — no email, phone or surname in the MVP.
 */
export default async function HostBookingPage({ params }: PageProps) {
  const { reference } = await params;
  const user = await requireHost(`/host/bookings/${reference}`);
  const b = await getHostBooking(user.id, reference);
  if (!b) notFound();

  const status = BOOKING_STATUS_LABELS[b.status];
  const money = (c: number) => formatMoney(c, b.currency, { showCents: true });
  const commissionPct = (b.hostCommissionBps / 100).toLocaleString("en-AU", { maximumFractionDigits: 2 });

  return (
    <HostShell current="/host/bookings" eyebrow={b.property.title} title={`Booking ${b.reference}`}>
      <Link href="/host/bookings" className="-mt-4 mb-6 inline-block text-sm font-semibold text-ink-soft hover:text-ink">
        ← All bookings
      </Link>
      <div className="grid gap-6 md:grid-cols-2">
        <Card className="space-y-3 p-5">
          <div className="flex flex-wrap gap-2">
            <Badge tone={status.tone}>{status.label}</Badge>
            {b.isDemo && <Badge tone="demo">Demo data</Badge>}
          </div>
          <dl className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <dt className="text-mist">Guest</dt>
              <dd className="font-semibold">{b.guestFirstName}</dd>
            </div>
            <div>
              <dt className="text-mist">Party</dt>
              <dd className="font-semibold">
                {pluralize(b.adults, "adult")}
                {b.children > 0 && `, ${pluralize(b.children, "child", "children")}`}
              </dd>
            </div>
            <div>
              <dt className="text-mist">Check-in</dt>
              <dd className="font-semibold">{formatStayDate(b.checkIn)}</dd>
            </div>
            <div>
              <dt className="text-mist">Check-out</dt>
              <dd className="font-semibold">{formatStayDate(b.checkOut)}</dd>
            </div>
            <div>
              <dt className="text-mist">Nights</dt>
              <dd className="font-semibold">{b.nights}</dd>
            </div>
            <div>
              <dt className="text-mist">Policy</dt>
              <dd className="font-semibold">{b.cancellationPolicy ? CANCELLATION_COPY[b.cancellationPolicy].title : "—"}</dd>
            </div>
          </dl>
          <p className="text-xs text-mist">Guest contact details are not shared in this version of Roavela.</p>
        </Card>

        <Card className="p-5">
          <h2 className="font-sans text-lg font-bold">Your proceeds ({b.currency})</h2>
          <dl className="mt-3 space-y-2 text-[0.9375rem]">
            <Row label={`Accommodation (${pluralize(b.nights, "night")})`} value={money(b.accommodationCents)} />
            <Row label={`Roavela commission (${commissionPct}% of accommodation)`} value={`− ${money(b.hostCommissionCents)}`} />
            <Row label="Cleaning fee (passed through in full)" value={money(b.cleaningFeeCents)} />
            <div className="flex justify-between gap-4 border-t border-ink/10 pt-3 font-bold">
              <dt>Estimated proceeds</dt>
              <dd className="tabular-nums">{money(b.hostPayoutCents)}</dd>
            </div>
          </dl>
          <p className="mt-3 text-xs text-mist">
            Gross, before payment-processing costs. Rates are fixed at booking time. Payouts aren&apos;t enabled yet (Stripe test mode).
            {b.status !== "CONFIRMED" && b.status !== "COMPLETED" && " This booking was cancelled; how cancelled bookings affect payouts will be settled when payouts are enabled."}
          </p>
        </Card>
      </div>
    </HostShell>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4 text-ink-soft">
      <dt>{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  );
}
