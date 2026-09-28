import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AmenityList } from "@/components/property/amenity-list";
import { BookingCard, MobileBookingBar } from "@/components/property/booking-card";
import { FavouriteButton } from "@/components/property/favourite-button";
import { LocationSection } from "@/components/property/location-section";
import { PropertyGallery } from "@/components/property/property-gallery";
import { ReviewSummary } from "@/components/property/review-summary";
import { Badge } from "@/components/ui/feedback";
import { Icon } from "@/components/ui/icons";
import { AMENITY_BY_KEY } from "@/config/amenities";
import { CANCELLATION_COPY } from "@/config/policies";
import { PROPERTY_TYPE_LABELS } from "@/config/search";
import { toIsoDate, todayInTimeZone } from "@/lib/dates";
import { formatDriveTime } from "@/lib/geo";
import { pluralize } from "@/lib/utils";
import { parseSearchParams, toSearchQuery } from "@/lib/validation/search";
import { getCurrentUser } from "@/server/auth/session";
import { env } from "@/server/env";
import { track } from "@/server/providers/analytics";
import { getPublicProperty, PUBLIC_AREA_RADIUS_METERS, type PublicProperty } from "@/server/services/properties";
import { getStayQuote } from "@/server/services/stay-quote";

type PageProps = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const property = await getPublicProperty(slug).catch(() => null);
  if (!property) return { title: "Stay not found", robots: { index: false } };
  const place = `${property.locality}, ${property.destination.name}`;
  return {
    title: `${property.title} · ${place}`,
    description: property.summary,
    alternates: { canonical: `/stays/${property.slug}` },
    // Demo listings must never be indexed as if they were real accommodation.
    robots: property.isDemo ? { index: false, follow: false } : undefined,
    openGraph: {
      type: "website",
      title: `${property.title} — ${place}`,
      description: property.summary,
      url: `/stays/${property.slug}`,
    },
  };
}

function highlightsFor(p: PublicProperty) {
  const out: { icon: string; title: string; body: string }[] = [];
  if (p.drive) {
    out.push({ icon: "car", title: `About ${formatDriveTime(p.drive.durationMinutes)} from ${p.drive.originName}`, body: "Estimated drive time — check conditions before you travel." });
  }
  const keys = new Set(p.amenities.map((a) => a.key));
  const featured = [...keys].map((k) => AMENITY_BY_KEY.get(k)).filter((a) => a?.highlight && a.category !== "FAMILY").slice(0, 2);
  for (const a of featured) if (a) out.push({ icon: a.icon, title: a.label, body: "Listed by the host as part of this stay." });
  if (keys.has("pet_friendly")) out.push({ icon: "paw", title: "Pets welcome", body: "Check the house rules for any limits." });
  else if (keys.has("family_friendly")) out.push({ icon: "family", title: "Great for families", body: "The host has marked this stay as family friendly." });
  if (p.cancellationPolicy === "FLEXIBLE") out.push({ icon: "calendar", title: "Flexible cancellation", body: CANCELLATION_COPY.FLEXIBLE.body });
  return out.slice(0, 4);
}

export default async function StayPage({ params, searchParams }: PageProps) {
  const { slug } = await params;
  const user = await getCurrentUser();
  const property = await getPublicProperty(slug, user?.id);
  if (!property) notFound();

  track({ name: "property_viewed", properties: { propertyId: property.id }, userId: user?.id });

  const search = parseSearchParams(await searchParams);
  const quote = search.stay ? await getStayQuote(property, search.stay, search.guests) : null;
  const selection = { checkIn: search.checkIn, checkOut: search.checkOut, adults: search.adults, children: search.children };
  const reserveHref = quote?.status === "ok" ? `/stays/${property.slug}/reserve?${toSearchQuery(selection)}` : null;
  const today = toIsoDate(todayInTimeZone("Australia/Sydney"));
  const highlights = highlightsFor(property);
  const hostingSince = new Intl.DateTimeFormat("en-AU", { month: "long", year: "numeric" }).format(property.host.createdAt);
  const place = [property.destination.name, property.adminArea].filter(Boolean).join(", ");

  // Structured data only for genuine listings — demo data must not look like real inventory.
  const jsonLd = property.isDemo
    ? null
    : {
        "@context": "https://schema.org",
        "@type": "VacationRental",
        name: property.title,
        description: property.summary,
        url: new URL(`/stays/${property.slug}`, env().APP_URL).toString(),
        image: property.images.map((i) => new URL(i.url, env().APP_URL).toString()),
        address: { "@type": "PostalAddress", addressLocality: property.locality, addressRegion: property.adminArea, addressCountry: property.countryCode },
        containsPlace: { "@type": "Accommodation", occupancy: { "@type": "QuantitativeValue", maxValue: property.maxGuests }, numberOfBedrooms: property.bedrooms, numberOfBathroomsTotal: property.bathrooms },
        ...(property.ratingAverage !== null && property.reviewCount > 0
          ? { aggregateRating: { "@type": "AggregateRating", ratingValue: property.ratingAverage, reviewCount: property.reviewCount, bestRating: 5 } }
          : {}),
      };

  return (
    <article className="container-page pt-6 pb-28 lg:pb-16">
      {jsonLd && (
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }} />
      )}

      {/* ── Header ── */}
      <header className="mb-5">
        <nav aria-label="Breadcrumb" className="mb-2 text-sm text-mist">
          <Link href="/search" className="hover:text-ink hover:underline">
            Stays
          </Link>
          <span aria-hidden> / </span>
          <Link href={`/search?destination=${property.destination.slug}`} className="hover:text-ink hover:underline">
            {property.destination.name}
          </Link>
        </nav>
        <div className="flex items-start justify-between gap-4">
          <h1 className="text-4xl leading-tight sm:text-5xl">{property.title}</h1>
          <FavouriteButton propertyId={property.id} propertyTitle={property.title} initialSaved={property.isFavourite} className="mt-1 shrink-0 border border-ink/10" />
        </div>
        <p className="mt-2 text-lg text-ink-soft">
          {property.locality} · {place}
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
          {property.ratingAverage !== null && property.reviewCount > 0 ? (
            <a href="#reviews" className="flex items-center gap-1 font-semibold hover:underline">
              <Icon name="star" size={16} className="fill-ochre-400 text-ochre-400" />
              {property.ratingAverage.toFixed(1)} · {pluralize(property.reviewCount, "review")}
            </a>
          ) : (
            <span className="text-sm font-semibold text-mist">New · no reviews yet</span>
          )}
          <span className="rounded-full bg-sand-100 px-3 py-1 text-sm font-semibold text-ink-soft">{PROPERTY_TYPE_LABELS[property.type]}</span>
          {property.isDemo && <Badge tone="demo">Demo listing — not a real property</Badge>}
        </div>
        <p className="mt-3 text-ink-soft">
          {pluralize(property.maxGuests, "guest")} · {pluralize(property.bedrooms, "bedroom")} · {pluralize(property.beds, "bed")} ·{" "}
          {pluralize(property.bathrooms, "bathroom")}
        </p>
      </header>

      <PropertyGallery images={property.images} title={property.title} />

      <div className="mt-10 grid gap-12 lg:grid-cols-[1fr_24rem]">
        <div className="min-w-0 divide-y divide-ink/10 [&>section]:py-10 [&>section:first-child]:pt-0">
          <section aria-labelledby="about">
            <h2 id="about" className="mb-4 text-2xl">
              About this stay
            </h2>
            <p className="text-lg text-ink">{property.summary}</p>
            {property.description.length > 400 ? (
              <details className="group mt-4">
                <summary className="cursor-pointer list-none font-semibold text-eucalypt-700 underline-offset-4 hover:underline [&::-webkit-details-marker]:hidden">
                  <span className="group-open:hidden">Read more</span>
                  <span className="hidden group-open:inline">Show less</span>
                </summary>
                <div className="mt-3 max-w-prose leading-relaxed whitespace-pre-line text-ink-soft">{property.description}</div>
              </details>
            ) : (
              <div className="mt-4 max-w-prose leading-relaxed whitespace-pre-line text-ink-soft">{property.description}</div>
            )}
          </section>

          {highlights.length > 0 && (
            <section aria-labelledby="highlights">
              <h2 id="highlights" className="mb-5 text-2xl">
                Highlights
              </h2>
              <ul className="grid gap-5 sm:grid-cols-2">
                {highlights.map((h) => (
                  <li key={h.title} className="flex gap-4">
                    <span className="grid size-11 shrink-0 place-items-center rounded-full bg-eucalypt-50 text-eucalypt-700">
                      <Icon name={h.icon} size={20} />
                    </span>
                    <div>
                      <p className="font-semibold">{h.title}</p>
                      <p className="text-sm text-mist">{h.body}</p>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section aria-labelledby="amenities">
            <h2 id="amenities" className="mb-5 text-2xl">
              What this place offers
            </h2>
            <AmenityList amenities={property.amenities} />
          </section>

          <section aria-labelledby="rules" className="grid gap-8 sm:grid-cols-2">
            <div>
              <h2 id="rules" className="mb-4 text-2xl">
                House rules
              </h2>
              <ul className="space-y-2.5 text-ink-soft">
                <li className="flex gap-2">
                  <Icon name="clock" size={18} className="mt-0.5 shrink-0" />
                  Check-in from {property.checkInTime}
                </li>
                <li className="flex gap-2">
                  <Icon name="clock" size={18} className="mt-0.5 shrink-0" />
                  Check-out by {property.checkOutTime}
                </li>
                <li className="flex gap-2">
                  <Icon name="users" size={18} className="mt-0.5 shrink-0" />
                  Up to {pluralize(property.maxGuests, "guest")}
                </li>
                <li className="flex gap-2">
                  <Icon name="calendar" size={18} className="mt-0.5 shrink-0" />
                  Minimum stay {pluralize(property.minNights, "night")}
                </li>
                {property.houseRules && <li className="whitespace-pre-line">{property.houseRules}</li>}
              </ul>
            </div>
            <div>
              <h2 className="mb-4 text-2xl">Cancellation policy</h2>
              <p className="font-semibold">{CANCELLATION_COPY[property.cancellationPolicy].title}</p>
              <p className="mt-1 text-ink-soft">{CANCELLATION_COPY[property.cancellationPolicy].body}</p>
              <p className="mt-3 text-sm text-mist">Policies apply once online booking launches.</p>
            </div>
          </section>

          <section aria-labelledby="location">
            <h2 id="location" className="mb-5 text-2xl">
              Location
            </h2>
            <LocationSection
              title={property.title}
              locality={property.locality}
              adminArea={property.adminArea}
              area={property.area}
              radiusMeters={PUBLIC_AREA_RADIUS_METERS}
              drive={property.drive}
              destination={property.destination}
              nearby={property.nearby}
            />
          </section>

          <section aria-labelledby="reviews-heading" id="reviews" className="scroll-mt-24">
            <h2 id="reviews-heading" className="mb-4 text-2xl">
              Reviews
            </h2>
            <ReviewSummary
              ratingAverage={property.ratingAverage}
              reviewCount={property.reviewCount}
              categories={property.categoryRatings}
              reviews={property.reviews}
            />
          </section>

          <section aria-labelledby="host">
            <h2 id="host" className="mb-4 text-2xl">
              Your host
            </h2>
            <div className="flex items-start gap-4">
              <span className="grid size-14 shrink-0 place-items-center rounded-full bg-eucalypt-700 font-display text-2xl text-white" aria-hidden>
                {property.host.displayName.charAt(0)}
              </span>
              <div>
                <p className="text-lg font-semibold">{property.host.displayName}</p>
                <p className="text-sm text-mist">
                  Hosting on Roavela since {hostingSince} · {pluralize(property.host._count.properties, "listing")}
                  {property.host.isDemo && " · Demo host"}
                </p>
                {property.host.bio && <p className="mt-3 max-w-prose text-ink-soft">{property.host.bio}</p>}
                <p className="mt-3 text-sm text-mist">Messaging hosts will be available with online booking.</p>
              </div>
            </div>
          </section>
        </div>

        {/* ── Booking preview (sticky on desktop) ── */}
        <aside id="booking" aria-label="Price and dates" className="scroll-mt-24 lg:sticky lg:top-24 lg:self-start">
          <BookingCard
            slug={property.slug}
            currency={property.currency}
            nightlyPriceCents={property.nightlyPriceCents}
            weekendPriceCents={property.weekendPriceCents}
            minNights={property.minNights}
            isDemo={property.isDemo}
            today={today}
            selection={selection}
            quote={quote}
            reserveHref={reserveHref}
          />
        </aside>
      </div>

      <MobileBookingBar currency={property.currency} nightlyPriceCents={property.nightlyPriceCents} quote={quote} reserveHref={reserveHref} />
    </article>
  );
}
