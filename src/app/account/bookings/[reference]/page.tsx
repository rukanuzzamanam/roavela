import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { CancelBookingForm } from "@/components/booking/cancel-booking-form";
import { StaySummary } from "@/components/booking/stay-summary";
import { Badge, Card } from "@/components/ui/feedback";
import { PriceBreakdown } from "@/components/ui/price-breakdown";
import { CANCELLATION_COPY } from "@/config/policies";
import { BOOKING_STATUS_LABELS, bookingPriceLines, houseRulesList, type HouseRulesSnapshot } from "@/lib/booking-lifecycle";
import { formatMoney } from "@/lib/money";
import { requirePermission } from "@/server/auth/guards";
import { getGuestBooking } from "@/server/services/bookings";
import { cancellationPreview } from "@/server/services/checkout";

export const metadata: Metadata = { title: "Booking details", robots: { index: false } };

type PageProps = { params: Promise<{ reference: string }> };

const PAYMENT_LABEL: Record<string, string> = {
  REQUIRES_PAYMENT: "Awaiting payment",
  PROCESSING: "Processing",
  SUCCEEDED: "Paid",
  FAILED: "Failed",
  CANCELLED: "Cancelled",
  PARTIALLY_REFUNDED: "Partially refunded",
  REFUNDED: "Refunded",
};

/** The guest's own booking only — any other reference is a 404 (no hint that it exists). */
export default async function BookingDetailPage({ params }: PageProps) {
  const { reference } = await params;
  const user = await requirePermission("booking:create", `/account/bookings/${reference}`);
  const booking = await getGuestBooking(user.id, reference);
  if (!booking) notFound();
  if (booking.status === "PENDING") redirect(`/checkout/${booking.reference}`);

  const status = BOOKING_STATUS_LABELS[booking.status];
  const policy = booking.cancellationPolicy ?? "MODERATE";
  const money = (c: number) => `${formatMoney(c, booking.currency, { showCents: true })} ${booking.currency}`;
  const preview = cancellationPreview(booking, booking.property.timezone);
  const hasPayment = booking.payments.some((p) => p.status === "SUCCEEDED");
  const rules = houseRulesList(booking.houseRulesSnapshot as HouseRulesSnapshot | null);
  const showAddress = booking.status === "CONFIRMED" || booking.status === "COMPLETED";
  const p = booking.property;

  return (
    <div className="container-page max-w-4xl py-10">
      <Link href="/account/bookings" className="text-sm font-semibold text-ink-soft hover:text-ink">
        ← Your trips
      </Link>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <h1 className="text-4xl">Booking {booking.reference}</h1>
        <Badge tone={status.tone}>{status.label}</Badge>
        {booking.isDemo && <Badge tone="demo">Demo data</Badge>}
      </div>

      <div className="mt-8 grid gap-6 md:grid-cols-[1fr_20rem]">
        <div className="space-y-6">
          <Card className="p-5">
            <StaySummary property={p} checkIn={booking.checkIn} checkOut={booking.checkOut} nights={booking.nights} adults={booking.adults} childCount={booking.children} isDemo={booking.isDemo} />
            {showAddress && p.addressLine1 && (
              <div className="mt-4 border-t border-ink/10 pt-4 text-sm">
                <p className="text-mist">Address</p>
                <p className="font-semibold">
                  {[p.addressLine1, p.addressLine2, p.locality, p.adminArea, p.postcode].filter(Boolean).join(", ")}
                </p>
                <p className="mt-2 text-mist">Hosted by {p.host.displayName}</p>
              </div>
            )}
          </Card>

          <section aria-labelledby="rules" className="space-y-2">
            <h2 id="rules" className="text-2xl">
              House rules
            </h2>
            <ul className="list-disc space-y-1 pl-5 text-ink-soft">
              {rules.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          </section>

          <section aria-labelledby="cancel" className="space-y-2">
            <h2 id="cancel" className="text-2xl">
              Cancellation
            </h2>
            <p className="text-ink-soft">
              <strong>{CANCELLATION_COPY[policy].title}:</strong> {CANCELLATION_COPY[policy].body}
            </p>
            {booking.status === "CONFIRMED" && preview && (
              <CancelBookingForm
                reference={booking.reference}
                refundLabel={hasPayment ? money(preview.refundCents) : `${money(0)} (no payment on record for this demo booking)`}
                explanation={preview.explanation}
              />
            )}
            {booking.status === "CONFIRMED" && !preview && <p className="text-sm text-mist">This stay has started, so it can&apos;t be cancelled online.</p>}
            {booking.status === "REFUND_PENDING" && (
              <p className="rounded-xl bg-ochre-50 p-3 text-sm text-ochre-700">
                Cancelled. A refund of {money(booking.refundDueCents ?? 0)} has been requested and will show as refunded once the payment provider confirms it.
              </p>
            )}
            {booking.status === "REFUNDED" && <p className="text-sm text-ink-soft">Cancelled and refunded {money(booking.refundDueCents ?? 0)}.</p>}
            {booking.status === "CANCELLED" && <p className="text-sm text-ink-soft">Cancelled. No refund was due under the cancellation policy.</p>}
          </section>
        </div>

        <aside aria-label="Payment summary">
          <Card className="space-y-4 p-5">
            <PriceBreakdown quote={bookingPriceLines(booking)} currency={booking.currency} totalLabel="Total" />
            {booking.payments.map((pay) => (
              <p key={pay.id} className="text-sm text-ink-soft">
                Payment: <strong>{PAYMENT_LABEL[pay.status] ?? pay.status}</strong>
                {pay.refundedCents > 0 && ` · refunded ${money(pay.refundedCents)}`}
                <span className="block text-xs text-mist">{pay.provider === "stripe" ? "Stripe test mode" : "Simulated (development)"} — no real money</span>
              </p>
            ))}
          </Card>
        </aside>
      </div>
    </div>
  );
}
