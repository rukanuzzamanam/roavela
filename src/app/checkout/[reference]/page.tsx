import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { CheckoutPayment } from "@/components/booking/checkout-payment";
import { HoldCountdown } from "@/components/booking/hold-countdown";
import { StaySummary } from "@/components/booking/stay-summary";
import { TestModeBanner } from "@/components/booking/test-mode-banner";
import { ButtonLink } from "@/components/ui/button";
import { Card, EmptyState } from "@/components/ui/feedback";
import { PriceBreakdown } from "@/components/ui/price-breakdown";
import { CANCELLATION_COPY } from "@/config/policies";
import { bookingPriceLines, houseRulesList, type HouseRulesSnapshot } from "@/lib/booking-lifecycle";
import { toIsoDate } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { toSearchQuery } from "@/lib/validation/search";
import { requireUser } from "@/server/auth/guards";
import { getPaymentConfig } from "@/server/payments/provider";
import { track } from "@/server/providers/analytics";
import { getCheckoutBooking } from "@/server/services/checkout";

export const metadata: Metadata = { title: "Checkout", robots: { index: false, follow: false } };

type PageProps = { params: Promise<{ reference: string }> };

/** Checkout for the signed-in guest's own PENDING hold. Another user's reference is a 404. */
export default async function CheckoutPage({ params }: PageProps) {
  const { reference } = await params;
  const user = await requireUser(`/checkout/${reference}`);
  const booking = await getCheckoutBooking(user.id, reference);
  if (!booking) notFound();

  if (booking.status !== "PENDING" && booking.status !== "EXPIRED") redirect(`/checkout/${booking.reference}/complete`);
  const retry = `/stays/${booking.property.slug}?${toSearchQuery({ checkIn: toIsoDate(booking.checkIn), checkOut: toIsoDate(booking.checkOut), adults: booking.adults, children: booking.children })}#booking`;

  if (booking.status === "EXPIRED") {
    return (
      <div className="container-page py-16">
        <EmptyState
          icon="clock"
          title="This checkout has expired"
          description="The dates were held for a limited time and have been released. You have not been charged and nothing was booked."
          action={<ButtonLink href={retry}>Check availability again</ButtonLink>}
        />
      </div>
    );
  }

  track({ name: "checkout_started", properties: { propertyId: booking.propertyId, bookingId: booking.id, nights: booking.nights }, userId: user.id });
  const payments = getPaymentConfig();
  const policy = booking.cancellationPolicy ?? "MODERATE";
  const rules = houseRulesList(booking.houseRulesSnapshot as HouseRulesSnapshot | null);
  const total = formatMoney(booking.totalCents, booking.currency, { showCents: true });

  return (
    <div className="container-page max-w-5xl py-8 sm:py-10">
      <h1 className="text-3xl sm:text-4xl">Confirm and pay</h1>
      <div className="mt-5">
        <TestModeBanner provider={payments.ok ? payments.provider : undefined} />
      </div>

      <div className="mt-8 grid gap-8 md:grid-cols-[1fr_22rem]">
        <div className="order-2 space-y-8 md:order-1">
          <section aria-labelledby="pay-heading">
            <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
              <h2 id="pay-heading" className="text-2xl">
                Payment
              </h2>
              {booking.expiresAt && <HoldCountdown expiresAt={booking.expiresAt.toISOString()} />}
            </div>
            <Card className="p-5">
              <CheckoutPayment reference={booking.reference} totalLabel={`${total} ${booking.currency}`} />
              <p className="mt-4 text-xs text-mist">
                Card details are entered in Stripe&apos;s secure form and never reach Roavela&apos;s servers. Your booking is confirmed once the payment is
                verified with us.
              </p>
            </Card>
          </section>

          <section aria-labelledby="you-heading">
            <h2 id="you-heading" className="text-2xl">
              Your details
            </h2>
            <dl className="mt-3 grid gap-3 sm:grid-cols-2">
              <div className="min-w-0">
                <dt className="text-sm text-mist">Name</dt>
                <dd className="font-semibold break-words">{booking.guest.name}</dd>
              </div>
              <div className="min-w-0">
                <dt className="text-sm text-mist">Confirmation email</dt>
                <dd className="font-semibold break-words">{booking.guest.email}</dd>
              </div>
            </dl>
          </section>

          <section aria-labelledby="policy-heading">
            <h2 id="policy-heading" className="text-2xl">
              Cancellation policy
            </h2>
            <p className="mt-2 text-ink-soft">
              <strong>{CANCELLATION_COPY[policy].title}:</strong> {CANCELLATION_COPY[policy].body}
            </p>
          </section>

          <section aria-labelledby="rules-heading">
            <h2 id="rules-heading" className="text-2xl">
              House rules
            </h2>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-ink-soft">
              {rules.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          </section>
        </div>

        <aside aria-label="Booking summary" className="order-1 md:order-2">
          <Card className="space-y-5 p-5 md:sticky md:top-24">
            <StaySummary
              property={booking.property}
              checkIn={booking.checkIn}
              checkOut={booking.checkOut}
              nights={booking.nights}
              adults={booking.adults}
              childCount={booking.children}
              isDemo={booking.isDemo}
            />
            <PriceBreakdown quote={bookingPriceLines(booking)} currency={booking.currency} />
            <p className="text-xs text-mist">
              Reference <span className="font-mono font-semibold text-ink">{booking.reference}</span>. Includes all Roavela fees. Prices are in {booking.currency}.
            </p>
          </Card>
        </aside>
      </div>
    </div>
  );
}
