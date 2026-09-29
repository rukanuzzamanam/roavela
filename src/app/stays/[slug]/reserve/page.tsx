import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ReserveForm } from "@/components/booking/reserve-form";
import { StaySummary } from "@/components/booking/stay-summary";
import { TestModeBanner } from "@/components/booking/test-mode-banner";
import { ButtonLink } from "@/components/ui/button";
import { Card, EmptyState } from "@/components/ui/feedback";
import { Icon } from "@/components/ui/icons";
import { PriceBreakdown } from "@/components/ui/price-breakdown";
import { CANCELLATION_COPY } from "@/config/policies";
import { CHECKOUT_HOLD_MINUTES, houseRulesList } from "@/lib/booking-lifecycle";
import { toIsoDate } from "@/lib/dates";
import { can } from "@/lib/permissions";
import { parseSearchParams, toSearchQuery } from "@/lib/validation/search";
import { getCurrentUser } from "@/server/auth/session";
import { getPaymentConfig } from "@/server/payments/provider";
import { track } from "@/server/providers/analytics";
import { getPublicProperty } from "@/server/services/properties";
import { describeQuoteProblem, getStayQuote } from "@/server/services/stay-quote";

export const metadata: Metadata = { title: "Review your trip", robots: { index: false, follow: false } };

type PageProps = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/**
 * Trip review. Re-validates the selection and shows the server's price. Nothing is held until the
 * guest presses "Continue to payment", which creates a short checkout hold on the server.
 */
export default async function ReservePage({ params, searchParams }: PageProps) {
  const { slug } = await params;
  const user = await getCurrentUser();
  const property = await getPublicProperty(slug, user?.id);
  if (!property) notFound();

  const search = parseSearchParams(await searchParams);
  const selection = { checkIn: search.checkIn, checkOut: search.checkOut, adults: search.adults, children: search.children };
  const back = `/stays/${property.slug}?${toSearchQuery(selection)}#booking`;
  const here = `/stays/${property.slug}/reserve?${toSearchQuery(selection)}`;

  if (!search.stay) {
    return (
      <div className="container-page py-16">
        <EmptyState
          icon="calendar"
          title="Choose your dates first"
          description="Pick check-in and check-out dates on the stay page to see your total."
          action={<ButtonLink href={back}>Back to {property.title}</ButtonLink>}
        />
      </div>
    );
  }

  const result = await getStayQuote(property, search.stay, search.guests);
  if (result.status !== "ok") {
    return (
      <div className="container-page py-16">
        <EmptyState
          icon="calendar"
          title="These dates don't work"
          description={describeQuoteProblem(result)}
          action={<ButtonLink href={back}>Change dates or guests</ButtonLink>}
        />
      </div>
    );
  }

  track({ name: "booking_preview_opened", properties: { propertyId: property.id, nights: search.stay.nights, guests: search.guests }, userId: user?.id });
  const { quote } = result;
  const payments = getPaymentConfig();
  const rules = houseRulesList(property);

  return (
    <div className="container-page max-w-5xl py-10">
      <Link href={back} className="inline-flex min-h-10 items-center gap-1 rounded-full pr-3 text-sm font-semibold text-ink-soft hover:text-ink">
        <Icon name="chevronRight" size={16} className="rotate-180" />
        Back to stay
      </Link>
      <h1 className="mt-2 text-4xl">Review your trip</h1>
      <div className="mt-6">
        <TestModeBanner provider={payments.ok ? payments.provider : undefined} />
      </div>

      <div className="mt-8 grid gap-8 md:grid-cols-[1fr_22rem]">
        <section aria-labelledby="trip" className="space-y-6">
          <h2 id="trip" className="sr-only">
            Your trip
          </h2>
          <Card className="p-5">
            <StaySummary
              property={property}
              checkIn={search.stay.checkIn}
              checkOut={search.stay.checkOut}
              nights={search.stay.nights}
              adults={search.adults}
              childCount={search.children}
              isDemo={property.isDemo}
            />
            <Link href={back} className="mt-4 inline-block text-sm font-semibold text-eucalypt-700 hover:underline">
              Change dates or guests
            </Link>
          </Card>
          <div>
            <h3 className="font-sans text-lg font-bold">Cancellation policy</h3>
            <p className="text-ink-soft">
              <strong>{CANCELLATION_COPY[property.cancellationPolicy].title}:</strong> {CANCELLATION_COPY[property.cancellationPolicy].body}
            </p>
          </div>
          <div>
            <h3 className="font-sans text-lg font-bold">House rules</h3>
            <ul className="mt-1 list-disc space-y-1 pl-5 text-ink-soft">
              {rules.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          </div>
          <div>
            <h3 className="font-sans text-lg font-bold">What happens next</h3>
            <p className="text-ink-soft">
              We&apos;ll hold these dates for {CHECKOUT_HOLD_MINUTES} minutes while you pay. Your booking is confirmed only once the payment is verified — if
              payment doesn&apos;t go through, nothing is booked and the dates are released.
            </p>
          </div>
        </section>

        <aside aria-label="Price summary">
          <Card className="p-5 md:sticky md:top-24">
            <PriceBreakdown quote={quote} currency={property.currency} />
            {!user ? (
              <ButtonLink href={`/login?next=${encodeURIComponent(here)}`} variant="accent" size="lg" className="mt-5 w-full">
                Log in to book
              </ButtonLink>
            ) : !can(user.role, "booking:create") ? (
              <p className="mt-5 rounded-xl bg-sand-100 p-3 text-sm text-ink-soft">Admin accounts can&apos;t make bookings. Log in with a traveller account.</p>
            ) : (
              <ReserveForm
                propertyId={property.id}
                checkIn={toIsoDate(search.stay.checkIn)}
                checkOut={toIsoDate(search.stay.checkOut)}
                adults={search.adults}
                childCount={search.children}
              />
            )}
            <p className="mt-2 text-center text-xs text-mist">You won&apos;t be charged yet.</p>
          </Card>
        </aside>
      </div>
    </div>
  );
}
