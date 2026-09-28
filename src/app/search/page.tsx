import type { Metadata } from "next";
import Link from "next/link";
import { MapView } from "@/components/maps/map-view";
import { PropertyCard } from "@/components/property/property-card";
import { FiltersPanel } from "@/components/search/filters-panel";
import { SearchBar } from "@/components/search/search-bar";
import { SortSelect } from "@/components/search/sort-select";
import { ButtonLink } from "@/components/ui/button";
import { Badge, EmptyState, ErrorState } from "@/components/ui/feedback";
import { Icon } from "@/components/ui/icons";
import { Pagination } from "@/components/ui/pagination";
import { COLLECTION_BY_SLUG } from "@/config/collections";
import { toIsoDate, todayInTimeZone } from "@/lib/dates";
import { formatDriveTime } from "@/lib/geo";
import { formatMoney } from "@/lib/money";
import { cn, pluralize } from "@/lib/utils";
import { countActiveFilters, parseSearchParams, toSearchQuery, type SearchParams } from "@/lib/validation/search";
import { getCurrentUser } from "@/server/auth/session";
import { track } from "@/server/providers/analytics";
import { listOrigins, listSearchDestinations, searchProperties, type SearchOutcome } from "@/server/services/search";
import type { OriginOption } from "@/types/marketplace";

export const metadata: Metadata = {
  title: "Find a stay",
  description: "Search stays by how far you want to drive.",
  // Search result permutations should not be indexed.
  robots: { index: false, follow: true },
};

type PageProps = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function SearchPage({ searchParams }: PageProps) {
  const raw = await searchParams;
  const params = parseSearchParams(raw);
  // The filter form shows only what the user chose explicitly, not what a collection preset added.
  const explicit = parseSearchParams({ ...raw, collection: undefined });
  const collection = params.collection ? COLLECTION_BY_SLUG.get(params.collection) : undefined;

  let outcome: SearchOutcome;
  let origins: OriginOption[];
  let destinations: OriginOption[];
  try {
    const user = await getCurrentUser();
    [outcome, origins, destinations] = await Promise.all([
      searchProperties(params, { userId: user?.id }),
      listOrigins(),
      listSearchDestinations(),
    ]);
  } catch (error) {
    console.error("[search] failed", error instanceof Error ? error.message : "unknown error");
    return (
      <div className="container-page py-16">
        <ErrorState
          title="Search is unavailable"
          description="We couldn't load stays right now. Please check your connection and try again in a moment."
          action={<ButtonLink href={`/search?${toSearchQuery(params)}`}>Try again</ButtonLink>}
        />
      </div>
    );
  }

  const { results, origin, totalResults, totalPages, page } = outcome;
  const activeFilterCount = countActiveFilters(explicit);
  const analytics = {
    origin: origin?.slug ?? params.from,
    maxDriveHours: params.drive,
    destination: params.destination,
    guests: params.guests,
    hasDates: Boolean(params.stay),
    resultCount: totalResults,
    collection: params.collection,
  };
  track({ name: "search_performed", properties: analytics });
  if (activeFilterCount > 0) {
    track({
      name: "search_filtered",
      properties: { filterCount: activeFilterCount, amenities: explicit.amenities, types: explicit.type, hasPriceFilter: explicit.minPrice !== undefined || explicit.maxPrice !== undefined, resultCount: totalResults },
    });
  }

  const destinationName = destinations.find((d) => d.slug === params.destination)?.name;
  const cardQuery = toSearchQuery({ checkIn: params.checkIn, checkOut: params.checkOut, adults: params.adults, children: params.children });
  const preserved = Object.fromEntries(
    Object.entries({
      from: params.from,
      destination: params.destination,
      drive: params.drive?.toString(),
      checkIn: params.checkIn,
      checkOut: params.checkOut,
      adults: params.adults.toString(),
      children: params.children ? params.children.toString() : undefined,
      collection: params.collection,
      sort: params.sort !== "recommended" ? params.sort : undefined,
      view: params.view !== "list" ? params.view : undefined,
    }).filter((e): e is [string, string] => e[1] !== undefined),
  );
  const whereWhenWho = {
    from: params.from,
    destination: params.destination,
    drive: params.drive,
    checkIn: params.checkIn,
    checkOut: params.checkOut,
    adults: params.adults,
    children: params.children,
  };
  const clearHref = `/search?${toSearchQuery(whereWhenWho)}`;
  const barDefaults = { ...whereWhenWho, maxPrice: params.maxPrice };
  const today = toIsoDate(todayInTimeZone("Australia/Sydney"));

  const heading = collection
    ? collection.title
    : destinationName
      ? `Stays in ${destinationName}`
      : params.drive
        ? `Stays under ${pluralize(params.drive, "hour")} from ${origin?.name ?? "you"}`
        : `Stays within driving distance of ${origin?.name ?? "you"}`;

  const summary = [
    destinationName ?? (origin && `From ${origin.name}`),
    params.drive ? `≤ ${params.drive}h drive` : null,
    params.stay ? `${params.checkIn} → ${params.checkOut}` : "Any dates",
    pluralize(params.guests, "guest"),
  ]
    .filter(Boolean)
    .join(" · ");

  const firstShown = (page - 1) * outcome.pageSize + 1;
  const lastShown = firstShown + results.length - 1;

  return (
    <div className="container-page pt-6 pb-10 sm:pt-8">
      {/* Mobile: collapsed summary that expands to the full form. Desktop: always-visible compact bar. */}
      <details className="group mb-6 rounded-3xl border border-ink/10 bg-white lg:hidden">
        <summary className="flex min-h-12 cursor-pointer list-none items-center gap-3 px-4 py-3 [&::-webkit-details-marker]:hidden">
          <Icon name="search" size={18} className="text-eucalypt-700" />
          <span className="min-w-0 flex-1 truncate text-sm font-semibold">{summary}</span>
          <span className="text-sm font-semibold text-eucalypt-700 group-open:hidden">Edit</span>
          <Icon name="chevronDown" size={18} className="hidden text-mist group-open:block" />
        </summary>
        <div className="border-t border-ink/10">
          <SearchBar origins={origins} destinations={destinations} today={today} defaults={barDefaults} variant="compact" />
        </div>
      </details>
      <div className="mb-8 hidden lg:block">
        <SearchBar origins={origins} destinations={destinations} today={today} defaults={barDefaults} variant="compact" />
      </div>

      <div className="grid gap-8 lg:grid-cols-[18rem_1fr]">
        <FiltersPanel
          values={{
            minPrice: explicit.minPrice,
            maxPrice: explicit.maxPrice,
            bedrooms: explicit.bedrooms,
            bathrooms: explicit.bathrooms,
            type: explicit.type,
            amenities: explicit.amenities,
          }}
          preserved={preserved}
          activeCount={activeFilterCount}
          clearHref={clearHref}
        />

        <section aria-labelledby="results-heading" className="min-w-0">
          <div className="mb-5 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h1 id="results-heading" className="text-3xl leading-tight sm:text-4xl">
                {heading}
              </h1>
              <p className="mt-1 text-mist" aria-live="polite">
                {totalResults === 0
                  ? "No stays found"
                  : totalPages > 1
                    ? `Showing ${firstShown}–${lastShown} of ${pluralize(totalResults, "stay")}`
                    : `${pluralize(totalResults, "stay")} found`}
                {outcome.originFallback && ` · We don't support that starting point yet, so we're showing results from ${origin?.name}.`}
              </p>
              {collection && (
                <Link
                  href={`/search?${toSearchQuery(params, { collection: undefined })}`}
                  className="mt-2 inline-flex min-h-9 items-center gap-1 rounded-full bg-eucalypt-50 px-3 py-1 text-sm font-semibold text-eucalypt-800 hover:bg-eucalypt-100"
                >
                  Collection: {collection.title}
                  <Icon name="close" size={14} />
                  <span className="sr-only">Remove collection</span>
                </Link>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <ViewToggle params={params} />
              <SortSelect value={params.sort} />
            </div>
          </div>

          {totalResults === 0 ? (
            <NoResults params={params} clearHref={clearHref} hasFilters={activeFilterCount > 0} destinations={destinations} />
          ) : (
            <>
              {params.view === "map" && (
                <MapView
                  className="mb-8"
                  connectOrigin
                  ariaLabel={`Map of ${pluralize(totalResults, "stay")}`}
                  caption={`All ${pluralize(totalResults, "matching stay")} at approximate locations. Schematic view — not a road map.`}
                  markers={[
                    ...(origin
                      ? [{ id: "origin", kind: "origin" as const, latitude: origin.latitude, longitude: origin.longitude, label: origin.name, ariaLabel: `Starting point: ${origin.name}` }]
                      : []),
                    ...outcome.mapPoints.map((m) => ({
                      id: m.id,
                      kind: "stay" as const,
                      latitude: m.latitude,
                      longitude: m.longitude,
                      label: formatMoney(m.nightlyPriceCents, m.currency),
                      href: `/stays/${m.slug}${cardQuery ? `?${cardQuery}` : ""}`,
                      ariaLabel: `${m.title}, ${formatMoney(m.nightlyPriceCents, m.currency)} per night${m.driveMinutes ? `, about ${formatDriveTime(m.driveMinutes)} drive` : ""}`,
                    })),
                  ]}
                />
              )}
              <ul className="grid gap-x-6 gap-y-10 sm:grid-cols-2 xl:grid-cols-3">
                {results.map((p, i) => (
                  <li key={p.id}>
                    <PropertyCard property={p} query={cardQuery} priority={params.view === "list" && i < 3} />
                  </li>
                ))}
              </ul>
              <Pagination
                className="mt-12"
                page={page}
                totalPages={totalPages}
                hrefFor={(p) => `/search?${toSearchQuery(params, { page: p > 1 ? String(p) : undefined })}`}
              />
            </>
          )}

          {results.some((r) => r.isDemo) && (
            <p className="mt-10 flex items-start gap-2 rounded-2xl bg-sand-100 p-4 text-sm text-ink-soft">
              <Badge tone="demo" className="shrink-0">
                Demo
              </Badge>
              Listings marked “Demo listing” are sample data for development and testing. They are not real properties and cannot be booked.
            </p>
          )}
        </section>
      </div>
    </div>
  );
}

function NoResults({
  params,
  clearHref,
  hasFilters,
  destinations,
}: {
  params: SearchParams;
  clearHref: string;
  hasFilters: boolean;
  destinations: OriginOption[];
}) {
  const canWiden = params.drive !== undefined && params.drive < 5;
  const others = destinations.filter((d) => d.slug !== params.destination);
  return (
    <EmptyState
      icon="car"
      title="No stays match those filters"
      description="Try removing a filter, changing your dates, driving a little further or exploring another destination."
      action={
        <div className="space-y-6">
          <div className="flex flex-wrap justify-center gap-3">
            {hasFilters && <ButtonLink href={clearHref}>Clear filters</ButtonLink>}
            {params.stay && (
              <ButtonLink href={`/search?${toSearchQuery(params, { checkIn: undefined, checkOut: undefined })}`} variant="outline">
                Change dates
              </ButtonLink>
            )}
            {canWiden && (
              <ButtonLink href={`/search?${toSearchQuery(params, { drive: String(params.drive! + 1) })}`} variant="outline">
                Drive up to {params.drive! + 1} hours
              </ButtonLink>
            )}
            {!hasFilters && !params.stay && !canWiden && <ButtonLink href="/search">Start a new search</ButtonLink>}
          </div>
          {others.length > 0 && (
            <div>
              <p className="mb-3 text-sm font-semibold text-ink-soft">Or explore another destination</p>
              <ul className="flex flex-wrap justify-center gap-2">
                {others.map((d) => (
                  <li key={d.slug}>
                    <Link
                      href={`/search?${toSearchQuery({ from: params.from, destination: d.slug, adults: params.adults, children: params.children, checkIn: params.checkIn, checkOut: params.checkOut })}`}
                      className="inline-flex min-h-10 items-center rounded-full border border-ink/15 bg-white px-4 text-sm font-semibold hover:border-eucalypt-600"
                    >
                      {d.name}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      }
    />
  );
}

function ViewToggle({ params }: { params: SearchParams }) {
  const item = "inline-flex h-10 items-center gap-1.5 rounded-full px-4 text-sm font-semibold transition-colors";
  return (
    <nav aria-label="Result view" className="inline-flex rounded-full border border-ink/10 bg-white p-1">
      {(["list", "map"] as const).map((v) => (
        <Link
          key={v}
          href={`/search?${toSearchQuery(params, { view: v === "list" ? undefined : v })}`}
          aria-current={params.view === v ? "page" : undefined}
          className={cn(item, params.view === v ? "bg-eucalypt-700 text-white" : "text-ink-soft hover:bg-ink/5")}
          scroll={false}
        >
          <Icon name={v} size={16} />
          {v === "list" ? "List" : "Map"}
        </Link>
      ))}
    </nav>
  );
}
