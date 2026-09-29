import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BookingCard, MobileBookingBar } from "@/components/property/booking-card";
import { PropertyDetailView } from "@/components/property/property-detail-view";
import { toIsoDate, todayInTimeZone } from "@/lib/dates";
import { parseSearchParams, toSearchQuery } from "@/lib/validation/search";
import { getCurrentUser } from "@/server/auth/session";
import { env } from "@/server/env";
import { track } from "@/server/providers/analytics";
import { getPublicProperty, PUBLIC_AREA_RADIUS_METERS } from "@/server/services/properties";
import { getStayQuote } from "@/server/services/stay-quote";

type PageProps = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const property = await getPublicProperty(slug).catch(() => null);
  if (!property) return { title: "Stay not found", robots: { index: false } };
  const place = [property.locality, property.destination?.name].filter(Boolean).join(", ");
  return {
    title: `${property.title} · ${place}`,
    description: property.summary ?? undefined,
    alternates: { canonical: `/stays/${property.slug}` },
    // Demo listings must never be indexed as if they were real accommodation.
    robots: property.isDemo ? { index: false, follow: false } : undefined,
    openGraph: {
      type: "website",
      title: `${property.title} — ${place}`,
      description: property.summary ?? undefined,
      url: `/stays/${property.slug}`,
    },
  };
}

export default async function StayPage({ params, searchParams }: PageProps) {
  const { slug } = await params;
  const user = await getCurrentUser();
  const property = await getPublicProperty(slug, user?.id);
  if (!property || property.nightlyPriceCents === null) notFound();

  track({ name: "property_viewed", properties: { propertyId: property.id }, userId: user?.id });

  const search = parseSearchParams(await searchParams);
  const quote = search.stay ? await getStayQuote(property, search.stay, search.guests) : null;
  const selection = { checkIn: search.checkIn, checkOut: search.checkOut, adults: search.adults, children: search.children };
  const reserveHref = quote?.status === "ok" ? `/stays/${property.slug}/reserve?${toSearchQuery(selection)}` : null;
  const today = toIsoDate(todayInTimeZone("Australia/Sydney"));

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
      {jsonLd && <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }} />}
      <PropertyDetailView
        property={property}
        mode="public"
        radiusMeters={PUBLIC_AREA_RADIUS_METERS}
        aside={
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
        }
      />
      <MobileBookingBar currency={property.currency} nightlyPriceCents={property.nightlyPriceCents} quote={quote} reserveHref={reserveHref} />
    </article>
  );
}
