import Link from "next/link";
import type { ReactNode } from "react";
import { Badge } from "@/components/ui/feedback";
import { Icon } from "@/components/ui/icons";
import { AMENITY_BY_KEY } from "@/config/amenities";
import { CANCELLATION_COPY } from "@/config/policies";
import { PROPERTY_TYPE_LABELS } from "@/config/search";
import { formatDriveTime } from "@/lib/geo";
import { pluralize } from "@/lib/utils";
import type { PropertyDetail } from "@/server/services/properties";
import { AmenityList } from "./amenity-list";
import { FavouriteButton } from "./favourite-button";
import { LocationSection } from "./location-section";
import { PropertyGallery } from "./property-gallery";
import { ReviewSummary } from "./review-summary";

/**
 * The property detail layout, shared by the public stay page and the host's listing preview so
 * the preview genuinely matches what guests will see. In "preview" mode, missing draft content is
 * shown as a clear placeholder instead of being hidden.
 */
export function PropertyDetailView({
  property,
  mode,
  radiusMeters,
  aside,
}: {
  property: PropertyDetail;
  mode: "public" | "preview";
  radiusMeters: number;
  /** Booking card (public) or preview notice (preview). */
  aside: ReactNode;
}) {
  const preview = mode === "preview";
  const missing = (label: string) => <p className="rounded-xl border border-dashed border-ochre-300 bg-ochre-50 p-3 text-sm text-ochre-700">Not added yet: {label}</p>;
  const place = [property.destination?.name, property.adminArea].filter(Boolean).join(", ");
  const hostingSince = new Intl.DateTimeFormat("en-AU", { month: "long", year: "numeric" }).format(property.host.createdAt);
  const highlights = highlightsFor(property);

  return (
    <>
      <header className="mb-5">
        {!preview && property.destination && (
          <nav aria-label="Breadcrumb" className="mb-2 text-sm text-mist">
            <Link href="/search" className="hover:text-ink hover:underline">
              Stays
            </Link>
            <span aria-hidden> / </span>
            <Link href={`/search?destination=${property.destination.slug}`} className="hover:text-ink hover:underline">
              {property.destination.name}
            </Link>
          </nav>
        )}
        <div className="flex items-start justify-between gap-4">
          <h1 className="text-4xl leading-tight sm:text-5xl">{property.title}</h1>
          {!preview && (
            <FavouriteButton propertyId={property.id} propertyTitle={property.title} initialSaved={property.isFavourite} className="mt-1 shrink-0 border border-ink/10" />
          )}
        </div>
        <p className="mt-2 text-lg text-ink-soft">{[property.locality, place].filter(Boolean).join(" · ") || (preview ? "Location not added yet" : "")}</p>
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

      {property.images.length === 0 && preview ? missing("photos") : <PropertyGallery images={property.images} title={property.title} />}

      <div className="mt-10 grid gap-12 lg:grid-cols-[1fr_24rem]">
        <div className="min-w-0 divide-y divide-ink/10 [&>section]:py-10 [&>section:first-child]:pt-0">
          <section aria-labelledby="about">
            <h2 id="about" className="mb-4 text-2xl">
              About this stay
            </h2>
            {property.summary ? <p className="text-lg text-ink">{property.summary}</p> : preview && missing("summary")}
            {property.description ? (
              property.description.length > 400 ? (
                <details className="group mt-4">
                  <summary className="cursor-pointer list-none font-semibold text-eucalypt-700 underline-offset-4 hover:underline [&::-webkit-details-marker]:hidden">
                    <span className="group-open:hidden">Read more</span>
                    <span className="hidden group-open:inline">Show less</span>
                  </summary>
                  <div className="mt-3 max-w-prose leading-relaxed whitespace-pre-line text-ink-soft">{property.description}</div>
                </details>
              ) : (
                <div className="mt-4 max-w-prose leading-relaxed whitespace-pre-line text-ink-soft">{property.description}</div>
              )
            ) : (
              preview && <div className="mt-3">{missing("description")}</div>
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
                <Rule icon="clock">Check-in from {property.checkInTime}</Rule>
                <Rule icon="clock">Check-out by {property.checkOutTime}</Rule>
                <Rule icon="users">Up to {pluralize(property.maxGuests, "guest")}</Rule>
                <Rule icon="calendar">Minimum stay {pluralize(property.minNights, "night")}</Rule>
                <Rule icon="paw">{property.petsAllowed ? "Pets allowed" : "No pets"}</Rule>
                <Rule icon="flame">{property.smokingAllowed ? "Smoking allowed" : "No smoking"}</Rule>
                <Rule icon="users">{property.eventsAllowed ? "Events allowed with host approval" : "No parties or events"}</Rule>
                {property.quietHoursStart && property.quietHoursEnd && (
                  <Rule icon="clock">
                    Quiet hours {property.quietHoursStart}–{property.quietHoursEnd}
                  </Rule>
                )}
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
            {property.area && property.destination ? (
              <LocationSection
                title={property.title}
                locality={property.locality ?? property.destination.name}
                adminArea={property.adminArea}
                area={property.area}
                radiusMeters={radiusMeters}
                drive={property.drive}
                destination={property.destination}
                nearby={property.nearby}
              />
            ) : (
              preview && missing("location")
            )}
          </section>

          <section aria-labelledby="reviews-heading" id="reviews" className="scroll-mt-24">
            <h2 id="reviews-heading" className="mb-4 text-2xl">
              Reviews
            </h2>
            <ReviewSummary ratingAverage={property.ratingAverage} reviewCount={property.reviewCount} categories={property.categoryRatings} reviews={property.reviews} />
          </section>

          <section aria-labelledby="host">
            <h2 id="host" className="mb-4 text-2xl">
              Your host
            </h2>
            <div className="flex items-start gap-4">
              {property.host.avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- small avatar from the storage provider
                <img src={property.host.avatarUrl} alt="" className="size-14 shrink-0 rounded-full object-cover" />
              ) : (
                <span className="grid size-14 shrink-0 place-items-center rounded-full bg-eucalypt-700 font-display text-2xl text-white" aria-hidden>
                  {property.host.displayName.charAt(0)}
                </span>
              )}
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

        <aside id="booking" aria-label="Price and dates" className="scroll-mt-24 lg:sticky lg:top-24 lg:self-start">
          {aside}
        </aside>
      </div>
    </>
  );
}

function Rule({ icon, children }: { icon: string; children: ReactNode }) {
  return (
    <li className="flex gap-2">
      <Icon name={icon} size={18} className="mt-0.5 shrink-0" />
      <span>{children}</span>
    </li>
  );
}

function highlightsFor(p: PropertyDetail) {
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
