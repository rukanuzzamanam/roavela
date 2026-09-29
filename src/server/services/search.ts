import "server-only";
import { AMENITY_BY_KEY } from "@/config/amenities";
import { MAX_SEARCH_CANDIDATES, SEARCH_PAGE_SIZE } from "@/config/search";
import { toIsoDate } from "@/lib/dates";
import { quoteStay } from "@/lib/pricing";
import type { SearchParams } from "@/lib/validation/search";
import { prisma } from "@/server/db";
import { demoListingsVisible } from "@/server/env";
import type { MapPoint, OriginOption, PropertyCardData } from "@/types/marketplace";
import { approximateLocation, locateProperty, resolvePropertyDrive } from "./drive-time";
import { getActiveFeeSchedule } from "./fees";
import { buildPropertyWhere, paginate, sortResults, type PageInfo } from "./search-query";

export interface SearchOutcome extends PageInfo {
  /** Card data for the requested page only. */
  results: PropertyCardData[];
  /** Every match (approximate positions) for the map view. */
  mapPoints: MapPoint[];
  origin: (OriginOption & { latitude: number; longitude: number }) | null;
  /** The requested origin slug was unknown and the default was used instead. */
  originFallback: boolean;
  /** More than MAX_SEARCH_CANDIDATES matched; only the first batch was ranked. */
  truncated: boolean;
}

export async function listOrigins(): Promise<OriginOption[]> {
  return prisma.destination.findMany({
    where: { isOrigin: true },
    select: { slug: true, name: true },
    orderBy: { name: "asc" },
  });
}

/** Published destinations that can be searched ("Where to?"). */
export async function listSearchDestinations(): Promise<OriginOption[]> {
  return prisma.destination.findMany({
    where: { isPublished: true },
    select: { slug: true, name: true },
    orderBy: { name: "asc" },
  });
}

async function resolveOrigin(slug: string) {
  const select = { id: true, slug: true, name: true, latitude: true, longitude: true } as const;
  const exact = await prisma.destination.findFirst({ where: { slug, isOrigin: true }, select });
  if (exact) return { origin: exact, fallback: false };
  const fallback = await prisma.destination.findFirst({ where: { isOrigin: true }, select, orderBy: { createdAt: "asc" } });
  return { origin: fallback, fallback: true };
}

/**
 * Two-phase search, all on the server:
 *   A. Select lightweight sort keys for every match (bounded by MAX_SEARCH_CANDIDATES), refine by
 *      per-property drive time, rank, and slice the requested page.
 *   B. Load full card data (images, amenities, favourites) for that page's ids only.
 * Totals therefore reflect exactly what the user can page through.
 */
export async function searchProperties(
  params: SearchParams,
  opts: { userId?: string | null; pageSize?: number; propertyIds?: string[] } = {},
): Promise<SearchOutcome> {
  const pageSize = opts.pageSize ?? SEARCH_PAGE_SIZE;
  const { origin, fallback } = await resolveOrigin(params.from);
  const base = buildPropertyWhere(params, { originId: origin?.id ?? null, includeDemo: demoListingsVisible() });
  const where = opts.propertyIds ? { AND: [base, { id: { in: opts.propertyIds } }] } : base;
  const stay = params.stay;

  // ── Phase A: sort keys ──
  const candidates = await prisma.property.findMany({
    where,
    take: MAX_SEARCH_CANDIDATES + 1,
    select: {
      id: true,
      slug: true,
      title: true,
      latitude: true,
      longitude: true,
      currency: true,
      nightlyPriceCents: true,
      weekendPriceCents: true,
      cleaningFeeCents: true,
      ratingAverage: true,
      reviewCount: true,
      destination: {
        select: {
          latitude: true,
          longitude: true,
          estimatesTo: origin
            ? { where: { originId: origin.id }, select: { durationMinutes: true, distanceMeters: true, source: true }, take: 1 }
            : false,
        },
      },
      availability: stay
        ? { where: { date: { gte: stay.checkIn, lt: stay.checkOut }, priceCents: { not: null } }, select: { date: true, priceCents: true } }
        : false,
    },
  });
  const truncated = candidates.length > MAX_SEARCH_CANDIDATES;
  if (truncated) candidates.pop();

  const feeSchedule = stay && candidates.length > 0 ? await getActiveFeeSchedule("AU") : null;

  // Published listings always have a destination and price (Property_listable_complete_check);
  // the guard only narrows types and skips anything malformed rather than failing the search.
  let ranked = candidates.flatMap((c) => {
    const { destination, nightlyPriceCents } = c;
    if (!destination || nightlyPriceCents === null) return [];
    const located = locateProperty(c, destination)!;
    const drive = origin ? resolvePropertyDrive(origin, destination.estimatesTo?.[0], destination, located.point) : null;
    let stayQuote: PropertyCardData["stay"];
    if (stay && feeSchedule) {
      const overrides = new Map((c.availability ?? []).map((a) => [toIsoDate(a.date), a.priceCents as number]));
      const quote = quoteStay(stay.checkIn, stay.checkOut, { ...c, nightlyPriceCents, overrides }, feeSchedule);
      stayQuote = { nights: quote.nights, totalCents: quote.guestTotalCents };
    }
    return [{ ...c, nightlyPriceCents, point: located.point, drive, stay: stayQuote }];
  });

  // Refine the coarse regional drive filter with the per-property estimate.
  if (params.drive !== undefined) {
    const max = params.drive * 60;
    ranked = ranked.filter((r) => !r.drive || r.drive.durationMinutes <= max);
  }

  ranked = sortResults(ranked, params.sort);
  const { items: pageItems, info } = paginate(ranked, params.page, pageSize);

  const mapPoints: MapPoint[] = ranked.map((r) => ({
    id: r.id,
    slug: r.slug,
    title: r.title,
    ...approximateLocation(r.point),
    nightlyPriceCents: r.nightlyPriceCents,
    currency: r.currency,
    driveMinutes: r.drive?.durationMinutes ?? null,
  }));

  // ── Phase B: hydrate one page ──
  const ids = pageItems.map((p) => p.id);
  const rows = ids.length
    ? await prisma.property.findMany({
        where: { id: { in: ids } },
        select: {
          id: true,
          type: true,
          locality: true,
          maxGuests: true,
          bedrooms: true,
          bathrooms: true,
          isDemo: true,
          destination: { select: { name: true, slug: true } },
          images: { select: { url: true, alt: true }, orderBy: { position: "asc" }, take: 1 },
          amenities: { select: { amenity: { select: { key: true } } } },
          favourites: opts.userId ? { where: { userId: opts.userId }, select: { userId: true } } : false,
        },
      })
    : [];
  const byId = new Map(rows.map((r) => [r.id, r]));

  const results: PropertyCardData[] = pageItems.flatMap((k) => {
    const p = byId.get(k.id);
    if (!p || !p.destination) return []; // changed between phases — skip rather than fail
    const highlights = p.amenities
      .map((a) => AMENITY_BY_KEY.get(a.amenity.key))
      .filter((a): a is NonNullable<typeof a> => Boolean(a?.highlight))
      .slice(0, 3)
      .map((a) => ({ key: a.key, label: a.label }));
    return [
      {
        id: k.id,
        slug: k.slug,
        title: k.title,
        type: p.type,
        locality: p.locality ?? p.destination.name,
        destinationName: p.destination.name,
        destinationSlug: p.destination.slug,
        imageUrl: p.images[0]?.url ?? null,
        imageAlt: p.images[0]?.alt ?? k.title,
        currency: k.currency,
        nightlyPriceCents: k.nightlyPriceCents,
        ratingAverage: k.ratingAverage,
        reviewCount: k.reviewCount,
        maxGuests: p.maxGuests,
        bedrooms: p.bedrooms,
        bathrooms: p.bathrooms,
        highlights,
        drive: k.drive,
        ...approximateLocation(k.point),
        isDemo: p.isDemo,
        isFavourite: (p.favourites?.length ?? 0) > 0,
        stay: k.stay,
      },
    ];
  });

  return {
    ...info,
    results,
    mapPoints,
    origin: origin ? { slug: origin.slug, name: origin.name, latitude: origin.latitude, longitude: origin.longitude } : null,
    originFallback: fallback,
    truncated,
  };
}
