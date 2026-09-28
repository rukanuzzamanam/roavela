import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { FavouriteButton } from "@/components/property/favourite-button";
import { PropertyImage } from "@/components/property/property-image";
import { StayQuoteForm } from "@/components/property/stay-quote-form";
import { Badge, Card, Rating } from "@/components/ui/feedback";
import { Icon } from "@/components/ui/icons";
import { PriceBreakdown } from "@/components/ui/price-breakdown";
import { AMENITY_BY_KEY } from "@/config/amenities";
import { PROPERTY_TYPE_LABELS } from "@/config/search";
import { toIsoDate, todayInTimeZone } from "@/lib/dates";
import { formatDistance, formatDriveTime } from "@/lib/geo";
import { formatMoney } from "@/lib/money";
import { quoteStay } from "@/lib/pricing";
import { pluralize } from "@/lib/utils";
import { parseSearchParams } from "@/lib/validation/search";
import { getCurrentUser } from "@/server/auth/session";
import { track } from "@/server/providers/analytics";
import { getActiveFeeSchedule } from "@/server/services/fees";
import { getPublicProperty } from "@/server/services/properties";

type PageProps = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const CANCELLATION_COPY = {
  FLEXIBLE: "Full refund up to 24 hours before check-in.",
  MODERATE: "Full refund up to 5 days before check-in. 50% refund after that, up until check-in.",
  STRICT: "50% refund up to 14 days before check-in. No refund after that.",
} as const;

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const property = await getPublicProperty(slug).catch(() => null);
  if (!property) return { title: "Stay not found" };
  return {
    title: `${property.title}, ${property.locality}`,
    description: property.summary,
    alternates: { canonical: `/stays/${property.slug}` },
    // Demo listings must never be indexed as if they were real.
    robots: property.isDemo ? { index: false, follow: false } : undefined,
    openGraph: { title: property.title, description: property.summary },
  };
}

export default async function StayPage({ params, searchParams }: PageProps) {
  const { slug } = await params;
  const user = await getCurrentUser();
  const property = await getPublicProperty(slug, user?.id);
  if (!property) notFound();

  track({ name: "property_viewed", properties: { propertyId: property.id }, userId: user?.id });

  const search = parseSearchParams(await searchParams);
  const stay = search.stay;
  const quote =
    stay && stay.nights >= property.minNights
      ? quoteStay(stay.checkIn, stay.checkOut, property, await getActiveFeeSchedule(property.countryCode))
      : null;
  const tooShort = stay && stay.nights < property.minNights;

  const [cover, ...rest] = property.images;
  const today = toIsoDate(todayInTimeZone("Australia/Sydney"));

  return (
    <article className="container-page pt-6 pb-16">
      {/* ── Title ── */}
      <header className="mb-5">
        <p className="text-sm font-bold tracking-wider text-eucalypt-600 uppercase">
          {property.destination.name} · {PROPERTY_TYPE_LABELS[property.type]}
        </p>
        <div className="mt-1 flex items-start justify-between gap-4">
          <h1 className="text-4xl leading-tight sm:text-5xl">{property.title}</h1>
          <FavouriteButton propertyId={property.id} propertyTitle={property.title} initialSaved={property.isFavourite} className="mt-1 border border-ink/10" />
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
          <Rating value={property.ratingAverage} count={property.reviewCount} />
          <span className="flex items-center gap-1 text-ink-soft">
            <Icon name="pin" size={16} />
            {property.locality}, {property.adminArea}
          </span>
          {property.drive && (
            <span className="flex items-center gap-1 text-ink-soft">
              <Icon name="car" size={16} />
              About {formatDriveTime(property.drive.durationMinutes)} ({formatDistance(property.drive.distanceMeters)}) from {property.drive.originName}
            </span>
          )}
          {property.isDemo && <Badge tone="demo">Demo listing — not bookable</Badge>}
        </div>
      </header>

      {/* ── Gallery: swipeable strip on mobile, mosaic on desktop ── */}
      <section aria-label="Photos">
        <ul className="scrollbar-none -mx-4 flex snap-x snap-mandatory gap-2 overflow-x-auto px-4 sm:hidden">
          {property.images.map((img, i) => (
            <li key={img.id} className="w-[88vw] shrink-0 snap-center">
              <PropertyImage src={img.url} alt={img.alt} priority={i === 0} sizes="88vw" className="aspect-[4/3] rounded-2xl" />
            </li>
          ))}
        </ul>
        <div className="hidden h-[28rem] grid-cols-4 grid-rows-2 gap-2 overflow-hidden rounded-[1.75rem] sm:grid lg:h-[32rem]">
          {cover && <PropertyImage src={cover.url} alt={cover.alt} priority sizes="50vw" className="col-span-2 row-span-2" />}
          {rest.slice(0, 4).map((img) => (
            <PropertyImage key={img.id} src={img.url} alt={img.alt} sizes="25vw" className="col-span-1" />
          ))}
        </div>
      </section>

      <div className="mt-10 grid gap-12 lg:grid-cols-[1fr_24rem]">
        <div className="min-w-0 space-y-10">
          <section className="flex flex-wrap gap-3 border-b border-ink/10 pb-8">
            {[
              { icon: "users", label: `Sleeps ${property.maxGuests}` },
              { icon: "home", label: pluralize(property.bedrooms, "bedroom") },
              { icon: "bed", label: pluralize(property.beds, "bed") },
              { icon: "bath", label: pluralize(property.bathrooms, "bathroom") },
            ].map((f) => (
              <span key={f.label} className="flex items-center gap-2 rounded-full bg-white px-4 py-2 font-semibold shadow-card">
                <Icon name={f.icon} size={18} className="text-eucalypt-600" />
                {f.label}
              </span>
            ))}
            <p className="w-full pt-2 text-ink-soft">Hosted by {property.host.displayName}</p>
          </section>

          <section aria-labelledby="about">
            <h2 id="about" className="mb-3 text-2xl">
              About this stay
            </h2>
            <p className="text-lg text-ink-soft">{property.summary}</p>
            <div className="mt-4 space-y-4 leading-relaxed whitespace-pre-line text-ink-soft">{property.description}</div>
          </section>

          <section aria-labelledby="amenities">
            <h2 id="amenities" className="mb-4 text-2xl">
              What this place offers
            </h2>
            <ul className="grid gap-3 sm:grid-cols-2">
              {property.amenities.map((a) => (
                <li key={a.key} className="flex items-center gap-3">
                  <Icon name={AMENITY_BY_KEY.get(a.key)?.icon ?? "check"} size={20} className="text-eucalypt-600" />
                  {a.label}
                </li>
              ))}
            </ul>
          </section>

          <section aria-labelledby="rules" className="grid gap-6 sm:grid-cols-2">
            <div>
              <h2 id="rules" className="mb-3 text-2xl">
                House rules
              </h2>
              <ul className="space-y-2 text-ink-soft">
                <li className="flex gap-2">
                  <Icon name="clock" size={18} className="mt-0.5 shrink-0" />
                  Check-in from {property.checkInTime} · Check-out by {property.checkOutTime}
                </li>
                <li className="flex gap-2">
                  <Icon name="calendar" size={18} className="mt-0.5 shrink-0" />
                  Minimum stay {pluralize(property.minNights, "night")}
                </li>
                {property.houseRules && <li className="whitespace-pre-line">{property.houseRules}</li>}
              </ul>
            </div>
            <div>
              <h2 className="mb-3 text-2xl">Cancellation</h2>
              <p className="text-ink-soft">
                <span className="font-semibold text-ink">{property.cancellationPolicy.charAt(0) + property.cancellationPolicy.slice(1).toLowerCase()}. </span>
                {CANCELLATION_COPY[property.cancellationPolicy]}
              </p>
            </div>
          </section>

          <section aria-labelledby="reviews">
            <h2 id="reviews" className="mb-1 text-2xl">
              Reviews
            </h2>
            <p className="mb-5 text-sm text-mist">Only guests who completed a stay can leave a review.</p>
            {property.reviews.length === 0 ? (
              <p className="text-ink-soft">No reviews yet.</p>
            ) : (
              <ul className="grid gap-5 sm:grid-cols-2">
                {property.reviews.map((r) => (
                  <li key={r.id}>
                    <Card className="h-full p-5">
                      <div className="flex items-center justify-between gap-2">
                        <p className="font-semibold">{r.authorName}</p>
                        <Rating value={r.overallRating} count={1} showCount={false} />
                      </div>
                      <p className="text-xs text-mist">
                        {new Intl.DateTimeFormat("en-AU", { month: "long", year: "numeric" }).format(r.createdAt)}
                        {r.isDemo && " · Demo review"}
                      </p>
                      <p className="mt-3 text-ink-soft">{r.body}</p>
                    </Card>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        {/* ── Booking card (sticky on desktop; appears after content on mobile) ── */}
        <aside aria-label="Pricing" className="lg:sticky lg:top-24 lg:self-start">
          <Card className="p-6">
            <p className="text-2xl font-bold">
              {formatMoney(property.nightlyPriceCents, property.currency)}
              <span className="text-base font-normal text-mist"> / night</span>
            </p>
            {property.weekendPriceCents && property.weekendPriceCents !== property.nightlyPriceCents && (
              <p className="text-sm text-mist">{formatMoney(property.weekendPriceCents, property.currency)} Fri & Sat nights</p>
            )}

            <StayQuoteForm
              slug={property.slug}
              today={today}
              defaults={{ checkIn: search.checkIn, checkOut: search.checkOut, adults: search.adults, children: search.children }}
            />

            {tooShort && (
              <p className="mt-4 rounded-xl bg-ochre-50 p-3 text-sm text-ochre-700" role="alert">
                This stay has a {pluralize(property.minNights, "night")} minimum.
              </p>
            )}
            {search.guests > property.maxGuests && (
              <p className="mt-4 rounded-xl bg-ochre-50 p-3 text-sm text-ochre-700" role="alert">
                This stay sleeps up to {property.maxGuests} guests.
              </p>
            )}
            {quote && (
              <div className="mt-5">
                <PriceBreakdown quote={quote} currency={property.currency} />
              </div>
            )}

            <button
              type="button"
              disabled
              className="mt-5 h-13 w-full rounded-full bg-ochre-500 font-semibold text-white opacity-50"
              aria-describedby="reserve-note"
            >
              Reserve
            </button>
            <p id="reserve-note" className="mt-2 text-center text-xs text-mist">
              {property.isDemo ? "Demo listings can't be booked." : "Online booking is coming soon."} You won&apos;t be charged.
            </p>
          </Card>
        </aside>
      </div>
    </article>
  );
}
