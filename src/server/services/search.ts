import "server-only";
import { AMENITY_BY_KEY } from "@/config/amenities";
import { SEARCH_PAGE_SIZE } from "@/config/search";
import { toIsoDate } from "@/lib/dates";
import { estimateDriveHeuristic, estimatePropertyDrive } from "@/lib/geo";
import { quoteStay } from "@/lib/pricing";
import type { SearchParams } from "@/lib/validation/search";
import { prisma } from "@/server/db";
import { demoListingsVisible } from "@/server/env";
import type { DriveInfo, OriginOption, PropertyCardData } from "@/types/marketplace";
import { getActiveFeeSchedule } from "./fees";
import { buildPropertyWhere, sortResults } from "./search-query";

export interface SearchOutcome {
  results: PropertyCardData[];
  origin: (OriginOption & { latitude: number; longitude: number }) | null;
  /** The requested origin slug was unknown and the default was used instead. */
  originFallback: boolean;
}

export async function listOrigins(): Promise<OriginOption[]> {
  return prisma.destination.findMany({
    where: { isOrigin: true },
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

export async function searchProperties(
  params: SearchParams,
  opts: { userId?: string | null; limit?: number; propertyIds?: string[] } = {},
): Promise<SearchOutcome> {
  const { origin, fallback } = await resolveOrigin(params.from);
  const base = buildPropertyWhere(params, { originId: origin?.id ?? null, includeDemo: demoListingsVisible() });
  const where = opts.propertyIds ? { AND: [base, { id: { in: opts.propertyIds } }] } : base;
  const stay = params.stay;

  const rows = await prisma.property.findMany({
    where,
    take: Math.min(opts.limit ?? SEARCH_PAGE_SIZE, SEARCH_PAGE_SIZE),
    orderBy: { publishedAt: "desc" },
    select: {
      id: true,
      slug: true,
      title: true,
      type: true,
      locality: true,
      latitude: true,
      longitude: true,
      currency: true,
      nightlyPriceCents: true,
      weekendPriceCents: true,
      cleaningFeeCents: true,
      ratingAverage: true,
      reviewCount: true,
      maxGuests: true,
      bedrooms: true,
      bathrooms: true,
      isDemo: true,
      countryCode: true,
      destination: {
        select: {
          name: true,
          slug: true,
          latitude: true,
          longitude: true,
          estimatesTo: origin
            ? { where: { originId: origin.id }, select: { durationMinutes: true, distanceMeters: true }, take: 1 }
            : false,
        },
      },
      images: { select: { url: true, alt: true }, orderBy: { position: "asc" }, take: 1 },
      amenities: { select: { amenity: { select: { key: true } } } },
      favourites: opts.userId ? { where: { userId: opts.userId }, select: { userId: true } } : false,
      availability: stay
        ? { where: { date: { gte: stay.checkIn, lt: stay.checkOut }, priceCents: { not: null } }, select: { date: true, priceCents: true } }
        : false,
    },
  });

  const feeSchedule = stay && rows.length > 0 ? await getActiveFeeSchedule("AU") : null;

  let results: PropertyCardData[] = rows.map((p) => {
    let drive: DriveInfo | null = null;
    if (origin) {
      const regional = p.destination.estimatesTo?.[0];
      const estimate = regional
        ? estimatePropertyDrive(regional, p.destination, p)
        : estimateDriveHeuristic(origin, p);
      drive = { originName: origin.name, ...estimate, approximate: true };
    }

    let stayQuote: PropertyCardData["stay"];
    if (stay && feeSchedule) {
      const overrides = new Map((p.availability ?? []).map((a) => [toIsoDate(a.date), a.priceCents as number]));
      const quote = quoteStay(stay.checkIn, stay.checkOut, { ...p, overrides }, feeSchedule);
      stayQuote = { nights: quote.nights, totalCents: quote.guestTotalCents };
    }

    const highlights = p.amenities
      .map((a) => AMENITY_BY_KEY.get(a.amenity.key))
      .filter((a): a is NonNullable<typeof a> => Boolean(a?.highlight))
      .slice(0, 3)
      .map((a) => ({ key: a.key, label: a.label }));

    return {
      id: p.id,
      slug: p.slug,
      title: p.title,
      type: p.type,
      locality: p.locality,
      destinationName: p.destination.name,
      destinationSlug: p.destination.slug,
      imageUrl: p.images[0]?.url ?? null,
      imageAlt: p.images[0]?.alt ?? p.title,
      currency: p.currency,
      nightlyPriceCents: p.nightlyPriceCents,
      ratingAverage: p.ratingAverage,
      reviewCount: p.reviewCount,
      maxGuests: p.maxGuests,
      bedrooms: p.bedrooms,
      bathrooms: p.bathrooms,
      highlights,
      drive,
      latitude: p.latitude,
      longitude: p.longitude,
      isDemo: p.isDemo,
      isFavourite: (p.favourites?.length ?? 0) > 0,
      stay: stayQuote,
    };
  });

  // Refine the regional drive filter with the per-property estimate.
  if (params.drive !== undefined) {
    const max = params.drive * 60;
    results = results.filter((r) => !r.drive || r.drive.durationMinutes <= max);
  }

  return {
    results: sortResults(results, params.sort),
    origin: origin ? { slug: origin.slug, name: origin.name, latitude: origin.latitude, longitude: origin.longitude } : null,
    originFallback: fallback,
  };
}
