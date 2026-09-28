import type { Metadata } from "next";
import Link from "next/link";
import { PropertyCard } from "@/components/property/property-card";
import { FiltersPanel } from "@/components/search/filters-panel";
import { ResultsMap } from "@/components/search/results-map";
import { SearchBar } from "@/components/search/search-bar";
import { SortSelect } from "@/components/search/sort-select";
import { ButtonLink } from "@/components/ui/button";
import { Badge, EmptyState, ErrorState } from "@/components/ui/feedback";
import { Icon } from "@/components/ui/icons";
import { COLLECTION_BY_SLUG } from "@/config/collections";
import { toIsoDate, todayInTimeZone } from "@/lib/dates";
import { cn, pluralize } from "@/lib/utils";
import { parseSearchParams, toSearchQuery } from "@/lib/validation/search";
import { getCurrentUser } from "@/server/auth/session";
import { track } from "@/server/providers/analytics";
import { listOrigins, searchProperties, type SearchOutcome } from "@/server/services/search";

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
  let origins;
  try {
    const user = await getCurrentUser();
    [outcome, origins] = await Promise.all([searchProperties(params, { userId: user?.id }), listOrigins()]);
  } catch (error) {
    console.error("[search] failed", error instanceof Error ? error.message : "unknown error");
    return (
      <div className="container-page py-16">
        <ErrorState
          title="Search is unavailable"
          description="We couldn't load stays right now. Please try again in a moment."
          action={<ButtonLink href="/search">Try again</ButtonLink>}
        />
      </div>
    );
  }

  const { results, origin } = outcome;
  track({
    name: "search_performed",
    properties: {
      origin: origin?.slug ?? params.from,
      maxDriveHours: params.drive,
      destination: params.to,
      guests: params.guests,
      hasDates: Boolean(params.stay),
      resultCount: results.length,
      collection: params.collection,
    },
  });

  const query = toSearchQuery(params);
  const cardQuery = toSearchQuery({ checkIn: params.checkIn, checkOut: params.checkOut, adults: params.adults, children: params.children });
  const activeFilterCount =
    explicit.type.length +
    explicit.amenities.length +
    [explicit.minPrice, explicit.maxPrice, explicit.bedrooms, explicit.bathrooms].filter((v) => v !== undefined).length;
  const preserved = Object.fromEntries(
    Object.entries({
      from: params.from,
      to: params.to,
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
  const clearHref = `/search?${toSearchQuery({ from: params.from, to: params.to, drive: params.drive, checkIn: params.checkIn, checkOut: params.checkOut, adults: params.adults, children: params.children })}`;

  const barDefaults = {
    from: params.from,
    to: params.to,
    drive: params.drive,
    checkIn: params.checkIn,
    checkOut: params.checkOut,
    adults: params.adults,
    children: params.children,
    maxPrice: params.maxPrice,
  };
  const today = toIsoDate(todayInTimeZone("Australia/Sydney"));

  const heading = collection
    ? collection.title
    : params.drive
      ? `Stays under ${pluralize(params.drive, "hour")} from ${origin?.name ?? "you"}`
      : `Stays within driving distance of ${origin?.name ?? "you"}`;

  const summary = [
    origin && `From ${origin.name}`,
    params.drive ? `≤ ${params.drive}h drive` : "Any distance",
    params.stay ? `${params.checkIn} → ${params.checkOut}` : "Any dates",
    pluralize(params.guests, "guest"),
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="container-page pt-6 pb-10 sm:pt-8">
      {/* Mobile: collapsed summary that expands to the full form. Desktop: always-visible compact bar. */}
      <details className="group mb-6 rounded-3xl border border-ink/10 bg-white lg:hidden">
        <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-3 [&::-webkit-details-marker]:hidden">
          <Icon name="search" size={18} className="text-eucalypt-700" />
          <span className="min-w-0 flex-1 truncate text-sm font-semibold">{summary}</span>
          <span className="text-sm font-semibold text-eucalypt-700 group-open:hidden">Edit</span>
          <Icon name="chevronDown" size={18} className="hidden text-mist group-open:block" />
        </summary>
        <div className="border-t border-ink/10">
          <SearchBar origins={origins} today={today} defaults={barDefaults} variant="compact" />
        </div>
      </details>
      <div className="mb-8 hidden lg:block">
        <SearchBar origins={origins} today={today} defaults={barDefaults} variant="compact" />
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
                {pluralize(results.length, "stay")} found
                {outcome.originFallback && ` · We don't support that starting point yet, so we're showing results from ${origin?.name}.`}
              </p>
              {collection && (
                <Link
                  href={`/search?${toSearchQuery(params, { collection: undefined })}`}
                  className="mt-2 inline-flex items-center gap-1 rounded-full bg-eucalypt-50 px-3 py-1 text-sm font-semibold text-eucalypt-800 hover:bg-eucalypt-100"
                >
                  Collection: {collection.title}
                  <Icon name="close" size={14} />
                  <span className="sr-only">Remove collection</span>
                </Link>
              )}
            </div>
            <div className="flex items-center gap-2">
              <ViewToggle params={params} />
              <SortSelect value={params.sort} />
            </div>
          </div>

          {results.length === 0 ? (
            <EmptyState
              icon="car"
              title="No stays match — yet"
              description={
                params.drive && params.drive < 5
                  ? "Try widening your drive time, changing your dates or removing a filter or two."
                  : "Try different dates or remove a filter or two."
              }
              action={
                <div className="flex flex-wrap justify-center gap-3">
                  {params.drive && params.drive < 5 && (
                    <ButtonLink href={`/search?${toSearchQuery(params, { drive: String(params.drive + 1) })}`}>
                      Widen to {params.drive + 1} hours
                    </ButtonLink>
                  )}
                  <ButtonLink href={clearHref} variant="outline">
                    Clear filters
                  </ButtonLink>
                </div>
              }
            />
          ) : params.view === "map" ? (
            <div className="space-y-6">
              <ResultsMap results={results} origin={origin} query={cardQuery} />
              <ul className="scrollbar-none -mx-4 flex snap-x gap-4 overflow-x-auto px-4 pb-2 sm:mx-0 sm:grid sm:grid-cols-2 sm:overflow-visible sm:px-0 xl:grid-cols-3">
                {results.map((p) => (
                  <li key={p.id} className="w-[78vw] max-w-80 shrink-0 snap-start sm:w-auto sm:max-w-none">
                    <PropertyCard property={p} query={cardQuery} />
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <ul className="grid gap-x-6 gap-y-10 sm:grid-cols-2 xl:grid-cols-3">
              {results.map((p, i) => (
                <li key={p.id}>
                  <PropertyCard property={p} query={cardQuery} priority={i < 3} />
                </li>
              ))}
            </ul>
          )}

          {results.some((r) => r.isDemo) && (
            <p className="mt-10 flex items-start gap-2 rounded-2xl bg-sand-100 p-4 text-sm text-ink-soft">
              <Badge tone="demo" className="shrink-0">
                Demo
              </Badge>
              Listings marked “Demo listing” are sample data for development and testing. They are not real properties and cannot be booked.
            </p>
          )}
          <p className="sr-only">Current search: {query}</p>
        </section>
      </div>
    </div>
  );
}

function ViewToggle({ params }: { params: ReturnType<typeof parseSearchParams> }) {
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
