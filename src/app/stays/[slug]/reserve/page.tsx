import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PropertyImage } from "@/components/property/property-image";
import { ButtonLink } from "@/components/ui/button";
import { Badge, Card, EmptyState } from "@/components/ui/feedback";
import { Icon } from "@/components/ui/icons";
import { PriceBreakdown } from "@/components/ui/price-breakdown";
import { CANCELLATION_COPY } from "@/config/policies";
import { formatStayDate } from "@/lib/dates";
import { pluralize } from "@/lib/utils";
import { parseSearchParams, toSearchQuery } from "@/lib/validation/search";
import { getCurrentUser } from "@/server/auth/session";
import { track } from "@/server/providers/analytics";
import { getPublicProperty } from "@/server/services/properties";
import { describeQuoteProblem, getStayQuote } from "@/server/services/stay-quote";

export const metadata: Metadata = { title: "Booking preview", robots: { index: false, follow: false } };

type PageProps = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/**
 * Booking preview. Online booking is not available yet, so this page re-validates the selection
 * server-side, shows the estimated price, and says plainly that nothing has been booked or charged.
 * It performs no writes.
 */
export default async function ReservePreviewPage({ params, searchParams }: PageProps) {
  const { slug } = await params;
  const user = await getCurrentUser();
  const property = await getPublicProperty(slug, user?.id);
  if (!property) notFound();

  const search = parseSearchParams(await searchParams);
  const selection = { checkIn: search.checkIn, checkOut: search.checkOut, adults: search.adults, children: search.children };
  const back = `/stays/${property.slug}?${toSearchQuery(selection)}#booking`;

  if (!search.stay) {
    return (
      <div className="container-page py-16">
        <EmptyState
          icon="calendar"
          title="Choose your dates first"
          description="Pick check-in and check-out dates on the stay page to see an estimated total."
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

  return (
    <div className="container-page max-w-5xl py-10">
      <Link href={back} className="inline-flex min-h-10 items-center gap-1 rounded-full pr-3 text-sm font-semibold text-ink-soft hover:text-ink">
        <Icon name="chevronRight" size={16} className="rotate-180" />
        Back to stay
      </Link>
      <h1 className="mt-2 text-4xl">Booking preview</h1>

      <div role="status" className="mt-6 flex gap-3 rounded-2xl border border-ochre-200 bg-ochre-50 p-5 text-ink">
        <Icon name="alert" size={22} className="mt-0.5 shrink-0 text-ochre-600" />
        <div>
          <p className="font-semibold">Online booking is coming soon.</p>
          <p className="mt-1 text-ink-soft">
            This is a price preview only. <strong>No booking has been made, the dates are not held, and you have not been charged.</strong>
          </p>
        </div>
      </div>

      <div className="mt-8 grid gap-8 md:grid-cols-[1fr_22rem]">
        <section aria-labelledby="trip" className="space-y-6">
          <h2 id="trip" className="text-2xl">
            Your trip
          </h2>
          <dl className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-2xl border border-ink/10 bg-white p-4">
              <dt className="text-sm text-mist">Dates</dt>
              <dd className="font-semibold">
                {formatStayDate(search.stay.checkIn)} → {formatStayDate(search.stay.checkOut)}
              </dd>
              <dd className="text-sm text-mist">{pluralize(search.stay.nights, "night")}</dd>
            </div>
            <div className="rounded-2xl border border-ink/10 bg-white p-4">
              <dt className="text-sm text-mist">Guests</dt>
              <dd className="font-semibold">
                {pluralize(search.adults, "adult")}
                {search.children > 0 && `, ${pluralize(search.children, "child", "children")}`}
              </dd>
            </div>
          </dl>
          <div>
            <h3 className="font-sans text-lg font-bold">Cancellation policy</h3>
            <p className="text-ink-soft">
              {CANCELLATION_COPY[property.cancellationPolicy].title}: {CANCELLATION_COPY[property.cancellationPolicy].body}
            </p>
          </div>
          <div>
            <h3 className="font-sans text-lg font-bold">What happens next</h3>
            <p className="text-ink-soft">
              When online booking launches you&apos;ll be able to confirm and pay securely here. For now, save this stay so it&apos;s easy to find again.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <ButtonLink href={back} variant="outline">
              Change dates or guests
            </ButtonLink>
            <ButtonLink href="/saved" variant="ghost">
              View saved stays
            </ButtonLink>
          </div>
        </section>

        <aside aria-label="Price summary">
          <Card className="overflow-hidden">
            <PropertyImage src={property.images[0]?.url ?? null} alt={property.images[0]?.alt ?? ""} sizes="22rem" className="aspect-[16/9]" />
            <div className="p-5">
              <p className="text-xs font-bold tracking-wider text-eucalypt-600 uppercase">{property.destination.name}</p>
              <p className="font-display text-xl">{property.title}</p>
              {property.isDemo && (
                <Badge tone="demo" className="mt-2">
                  Demo listing
                </Badge>
              )}
              <div className="mt-5">
                <PriceBreakdown quote={quote} currency={property.currency} totalLabel="Estimated total" />
              </div>
              <button type="button" disabled className="mt-5 h-12 w-full rounded-full bg-ochre-500 font-semibold text-white opacity-50" aria-describedby="confirm-note">
                Confirm and pay
              </button>
              <p id="confirm-note" className="mt-2 text-center text-xs text-mist">
                Unavailable until online booking launches.
              </p>
            </div>
          </Card>
        </aside>
      </div>
    </div>
  );
}
