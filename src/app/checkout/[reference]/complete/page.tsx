import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { StatusPoller } from "@/components/booking/status-poller";
import { StaySummary } from "@/components/booking/stay-summary";
import { ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/feedback";
import { Icon } from "@/components/ui/icons";
import { formatMoney } from "@/lib/money";
import { requireUser } from "@/server/auth/guards";
import { getCheckoutBooking } from "@/server/services/checkout";

export const metadata: Metadata = { title: "Booking status", robots: { index: false, follow: false } };

type PageProps = { params: Promise<{ reference: string }> };

/**
 * Where the guest lands after paying (and Stripe's return_url). It shows the SERVER's state only;
 * any payment_intent / redirect_status query parameters are ignored — the browser redirect is not
 * proof of payment. While the webhook is pending, it polls.
 */
export default async function CheckoutCompletePage({ params }: PageProps) {
  const { reference } = await params;
  const user = await requireUser(`/checkout/${reference}/complete`);
  const booking = await getCheckoutBooking(user.id, reference);
  if (!booking) notFound();

  const payment = booking.payments[0];
  const summary = (
    <Card className="mt-8 p-5 text-left">
      <StaySummary
        property={booking.property}
        checkIn={booking.checkIn}
        checkOut={booking.checkOut}
        nights={booking.nights}
        adults={booking.adults}
        childCount={booking.children}
        isDemo={booking.isDemo}
      />
    </Card>
  );

  let body;
  if (booking.status === "CONFIRMED" || booking.status === "COMPLETED") {
    body = (
      <>
        <Icon name="check" size={48} className="mx-auto rounded-full bg-eucalypt-100 p-2 text-eucalypt-700" />
        <h1 className="mt-4 text-4xl">You&apos;re booked!</h1>
        <p className="mt-3 text-ink-soft">
          Booking <span className="font-mono font-semibold text-ink">{booking.reference}</span> is confirmed and we&apos;ve emailed your confirmation. Paid{" "}
          {formatMoney(booking.totalCents, booking.currency, { showCents: true })} {booking.currency}{" "}
          <span className="font-semibold">(test mode — no real money)</span>.
        </p>
        {summary}
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <ButtonLink href={`/account/bookings/${booking.reference}`}>View booking</ButtonLink>
          <ButtonLink href="/account/bookings" variant="outline">
            All trips
          </ButtonLink>
        </div>
      </>
    );
  } else if (booking.status === "PENDING" && payment?.status === "FAILED") {
    body = (
      <>
        <Icon name="alert" size={48} className="mx-auto text-ochre-600" />
        <h1 className="mt-4 text-4xl">Payment didn&apos;t go through</h1>
        <p className="mt-3 text-ink-soft">
          Your booking is <strong>not</strong> confirmed and you haven&apos;t been charged. Your dates are still held for a few minutes if you&apos;d like to try again.
        </p>
        {summary}
        <div className="mt-6">
          <ButtonLink href={`/checkout/${booking.reference}`} variant="accent">
            Try again
          </ButtonLink>
        </div>
      </>
    );
  } else if (booking.status === "PENDING") {
    body = (
      <>
        <div className="mx-auto size-11 animate-spin rounded-full border-4 border-eucalypt-100 border-t-eucalypt-600" aria-hidden />
        <h1 className="mt-4 text-4xl" aria-live="polite">
          Confirming your payment…
        </h1>
        <p className="mt-3 text-ink-soft">We&apos;re waiting for the payment provider to confirm your payment. This usually takes a few seconds.</p>
        <div className="mt-4">
          <StatusPoller />
        </div>
        {summary}
      </>
    );
  } else if (booking.status === "EXPIRED") {
    const paid = payment && ["SUCCEEDED", "REFUNDED", "PARTIALLY_REFUNDED"].includes(payment.status);
    body = (
      <>
        <Icon name="clock" size={48} className="mx-auto text-ochre-600" />
        <h1 className="mt-4 text-4xl">This booking wasn&apos;t completed</h1>
        <p className="mt-3 text-ink-soft">
          {paid
            ? "Your payment arrived after the hold expired and the dates were no longer available, so a full refund has been requested."
            : "The checkout hold expired before payment was completed. Nothing was booked and you haven't been charged."}
        </p>
        <div className="mt-6">
          <ButtonLink href={`/stays/${booking.property.slug}`}>Back to the stay</ButtonLink>
        </div>
      </>
    );
  } else {
    body = (
      <>
        <h1 className="text-4xl">Booking {booking.reference}</h1>
        <p className="mt-3 text-ink-soft">This booking has been cancelled.</p>
        <div className="mt-6">
          <ButtonLink href={`/account/bookings/${booking.reference}`}>View booking</ButtonLink>
        </div>
      </>
    );
  }

  return <div className="container-page max-w-2xl py-16 text-center">{body}</div>;
}
