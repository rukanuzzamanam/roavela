import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { DestinationCard } from "@/components/destination/destination-card";
import { PropertyCard } from "@/components/property/property-card";
import { SearchBar } from "@/components/search/search-bar";
import { ErrorState, Skeleton } from "@/components/ui/feedback";
import { Icon } from "@/components/ui/icons";
import { COLLECTIONS, type CollectionPreset } from "@/config/collections";
import { DEFAULT_ORIGIN_SLUG, DRIVE_TIME_OPTIONS } from "@/config/search";
import { siteConfig } from "@/config/site";
import { toIsoDate, todayInTimeZone } from "@/lib/dates";
import { parseSearchParams } from "@/lib/validation/search";
import { getCurrentUser } from "@/server/auth/session";
import { listDestinationsFrom } from "@/server/services/destinations";
import { listOrigins, searchProperties } from "@/server/services/search";

export default async function HomePage() {
  // Always render per request: content depends on live inventory.
  await connection();
  const origins = await listOrigins().catch(() => []);
  const defaultOrigin = origins.find((o) => o.slug === DEFAULT_ORIGIN_SLUG) ?? origins[0];
  const originName = defaultOrigin?.name ?? "home";
  const today = toIsoDate(todayInTimeZone("Australia/Sydney"));

  return (
    <>
      {/* ── Hero ── */}
      <section className="relative isolate overflow-hidden bg-eucalypt-900">
        <div aria-hidden className="absolute inset-0 -z-10 bg-[url(/brand/hero.svg)] bg-cover bg-bottom" />
        <div aria-hidden className="absolute inset-0 -z-10 bg-gradient-to-b from-eucalypt-900/70 via-eucalypt-900/30 to-eucalypt-900/10" />
        <div className="container-page pt-14 pb-40 sm:pt-20 lg:pt-28 lg:pb-48">
          <p className="mb-5 inline-flex items-center gap-2 rounded-full bg-white/10 px-3.5 py-1.5 text-sm font-semibold text-ochre-200 backdrop-blur">
            <Icon name="car" size={16} />
            Road-trip stays, sorted by drive time
          </p>
          <h1 className="max-w-3xl text-[2.75rem] leading-[1.02] font-semibold text-white sm:text-6xl lg:text-7xl">
            Find somewhere <em className="font-normal text-ochre-200">worth the drive.</em>
          </h1>
          <p className="mt-5 max-w-xl text-lg text-eucalypt-50/90 sm:text-xl">
            Discover beautiful stays, weekend escapes and experiences within driving distance.
          </p>
        </div>
      </section>

      <div className="container-page relative z-10 -mt-32 lg:-mt-36">
        {origins.length > 0 ? (
          <SearchBar origins={origins} today={today} defaults={{ from: defaultOrigin?.slug }} />
        ) : (
          <ErrorState description="Search is temporarily unavailable. Please try again shortly." />
        )}
      </div>

      {/* ── Drive-time quick picks ── */}
      <section aria-labelledby="drive-heading" className="container-page mt-14">
        <h2 id="drive-heading" className="font-sans text-sm font-bold tracking-wider text-mist uppercase">
          How far do you feel like driving from {originName}?
        </h2>
        <ul className="scrollbar-none -mx-4 mt-4 flex gap-3 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0">
          {DRIVE_TIME_OPTIONS.map((h) => (
            <li key={h} className="shrink-0">
              <Link
                href={`/search?from=${defaultOrigin?.slug ?? DEFAULT_ORIGIN_SLUG}&drive=${h}`}
                className="group flex items-center gap-3 rounded-full border border-ink/10 bg-white py-2 pr-5 pl-2 font-semibold shadow-card transition hover:border-eucalypt-600"
              >
                <span className="grid size-9 place-items-center rounded-full bg-eucalypt-50 text-eucalypt-700 group-hover:bg-eucalypt-700 group-hover:text-white">
                  {h}h
                </span>
                Under {h} {h === 1 ? "hour" : "hours"}
              </Link>
            </li>
          ))}
        </ul>
      </section>

      {/* ── Destinations by drive time ── */}
      {defaultOrigin && (
        <section aria-labelledby="dest-heading" className="container-page mt-16">
          <SectionHeading id="dest-heading" eyebrow={`From ${originName}`} title="Escapes by drive time" />
          <Suspense fallback={<RailSkeleton tall />}>
            <DestinationsRail originSlug={defaultOrigin.slug} />
          </Suspense>
        </section>
      )}

      {/* ── Curated collections ── */}
      {defaultOrigin &&
        COLLECTIONS.map((c) => (
          <section key={c.slug} aria-labelledby={`c-${c.slug}`} className="container-page mt-16">
            <SectionHeading
              id={`c-${c.slug}`}
              title={c.slug === "popular-nearby" ? `Popular near ${originName}` : c.title}
              description={c.description}
              href={`/search?from=${defaultOrigin.slug}&collection=${c.slug}`}
            />
            <Suspense fallback={<RailSkeleton />}>
              <CollectionRail collection={c} originSlug={defaultOrigin.slug} />
            </Suspense>
          </section>
        ))}

      <section className="container-page mt-20">
        <div className="grid gap-8 rounded-[2rem] bg-eucalypt-800 p-8 text-white sm:p-12 lg:grid-cols-3">
          {[
            { icon: "car", title: "Search by drive time", body: "Tell us how far you'll go. We'll show what's worth it." },
            { icon: "compass", title: "Stays with a sense of place", body: "Cabins, farm stays, beach houses and hideaways — reviewed by real guests after real stays." },
            { icon: "shield", title: "Reviewed before listing", body: "Every new listing is reviewed by our team before it appears in search." },
          ].map((f) => (
            <div key={f.title}>
              <Icon name={f.icon} size={28} className="text-ochre-300" />
              <h2 className="mt-4 text-2xl">{f.title}</h2>
              <p className="mt-2 text-eucalypt-100">{f.body}</p>
            </div>
          ))}
        </div>
        <p className="sr-only">{siteConfig.description}</p>
      </section>
    </>
  );
}

function SectionHeading({ id, eyebrow, title, description, href }: { id: string; eyebrow?: string; title: string; description?: string; href?: string }) {
  return (
    <div className="mb-6 flex items-end justify-between gap-4">
      <div>
        {eyebrow && <p className="mb-1 text-sm font-bold tracking-wider text-ochre-600 uppercase">{eyebrow}</p>}
        <h2 id={id} className="text-3xl sm:text-4xl">
          {title}
        </h2>
        {description && <p className="mt-1.5 text-mist">{description}</p>}
      </div>
      {href && (
        <Link href={href} className="hidden shrink-0 items-center gap-1 rounded-full px-3 py-2 font-semibold text-eucalypt-700 hover:bg-eucalypt-50 sm:inline-flex">
          See all <Icon name="arrowRight" size={16} />
          <span className="sr-only">{title}</span>
        </Link>
      )}
    </div>
  );
}

// Each rail fails independently: one unavailable query shows an inline error, not a broken page.

async function DestinationsRail({ originSlug }: { originSlug: string }) {
  const destinations = await listDestinationsFrom(originSlug, 5 * 60).catch(() => null);
  if (!destinations) return <ErrorState className="py-8" />;
  if (destinations.length === 0) return <p className="text-mist">Destinations are coming soon.</p>;
  return (
    <ul className="scrollbar-none -mx-4 flex snap-x snap-mandatory gap-4 overflow-x-auto px-4 pb-2 sm:mx-0 sm:grid sm:grid-cols-2 sm:overflow-visible sm:px-0 lg:grid-cols-4">
      {destinations.map((d) => (
        <li key={d.slug} className="w-[72vw] max-w-72 shrink-0 snap-start sm:w-auto sm:max-w-none">
          <DestinationCard destination={d} originSlug={originSlug} />
        </li>
      ))}
    </ul>
  );
}

async function loadCollection(collection: CollectionPreset, originSlug: string) {
  const user = await getCurrentUser();
  const params = parseSearchParams({ from: originSlug, collection: collection.slug });
  const { results } = await searchProperties(params, { userId: user?.id, limit: 8 });
  return results;
}

async function CollectionRail({ collection, originSlug }: { collection: CollectionPreset; originSlug: string }) {
  const results = await loadCollection(collection, originSlug).catch(() => null);
  if (!results) return <ErrorState className="py-8" />;
  if (results.length === 0) return <p className="text-mist">No stays in this collection yet — check back soon.</p>;
  return (
    <ul className="scrollbar-none -mx-4 flex snap-x snap-mandatory gap-5 overflow-x-auto px-4 pb-2 sm:mx-0 sm:grid sm:grid-cols-2 sm:overflow-visible sm:px-0 lg:grid-cols-4">
      {results.slice(0, 4).map((p) => (
        <li key={p.id} className="w-[78vw] max-w-80 shrink-0 snap-start sm:w-auto sm:max-w-none">
          <PropertyCard property={p} className="h-full" />
        </li>
      ))}
    </ul>
  );
}

function RailSkeleton({ tall = false }: { tall?: boolean }) {
  return (
    <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4" aria-busy="true" aria-label="Loading">
      {Array.from({ length: 4 }, (_, i) => (
        <div key={i} className={i > 0 ? "hidden sm:block" : undefined}>
          <Skeleton className={tall ? "aspect-[3/4]" : "aspect-[4/3]"} />
          {!tall && (
            <>
              <Skeleton className="mt-3 h-4 w-1/2" />
              <Skeleton className="mt-2 h-5 w-3/4" />
            </>
          )}
        </div>
      ))}
    </div>
  );
}
