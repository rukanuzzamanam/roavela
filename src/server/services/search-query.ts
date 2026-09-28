import type { Prisma } from "@/generated/prisma/client";
import type { SortOption } from "@/config/search";
import type { SearchParams } from "@/lib/validation/search";
import type { PropertyCardData } from "@/types/marketplace";

/**
 * Pure query-building and ranking for property search. Kept free of I/O so the rules
 * (what is searchable, how availability is checked) are unit-testable.
 */

/** Bookings in these states hold the dates. Must match the DB exclusion constraint. */
export const ACTIVE_BOOKING_STATUSES = ["PENDING", "CONFIRMED"] as const;

export interface SearchContext {
  originId: string | null;
  includeDemo: boolean;
}

export function buildPropertyWhere(params: SearchParams, ctx: SearchContext): Prisma.PropertyWhereInput {
  const and: Prisma.PropertyWhereInput[] = [];

  // Only admin-approved, live listings are ever publicly searchable.
  and.push({ status: "PUBLISHED" });
  if (!ctx.includeDemo) and.push({ isDemo: false });

  and.push({ maxGuests: { gte: params.guests } });
  if (params.bedrooms !== undefined) and.push({ bedrooms: { gte: params.bedrooms } });
  if (params.maxBedrooms !== undefined) and.push({ bedrooms: { lte: params.maxBedrooms } });
  if (params.bathrooms !== undefined) and.push({ bathrooms: { gte: params.bathrooms } });
  if (params.type.length > 0) and.push({ type: { in: params.type } });
  if (params.minPrice !== undefined) and.push({ nightlyPriceCents: { gte: params.minPrice * 100 } });
  if (params.maxPrice !== undefined) and.push({ nightlyPriceCents: { lte: params.maxPrice * 100 } });

  for (const key of params.amenities) {
    and.push({ amenities: { some: { amenity: { key } } } });
  }
  if (params.anyAmenities.length > 0) {
    and.push({ amenities: { some: { amenity: { key: { in: params.anyAmenities } } } } });
  }

  if (params.to) {
    // Match the destination itself or any place nested beneath it.
    and.push({ destination: { OR: [{ slug: params.to }, { parent: { slug: params.to } }] } });
  }

  if (params.drive !== undefined && ctx.originId) {
    // Coarse filter on the stored region estimate; refined per property after the query.
    and.push({
      destination: { estimatesTo: { some: { originId: ctx.originId, durationMinutes: { lte: params.drive * 60 } } } },
    });
  }

  if (params.stay) {
    const { checkIn, checkOut, nights } = params.stay;
    and.push({ minNights: { lte: nights } });
    and.push({ OR: [{ maxNights: null }, { maxNights: { gte: nights } }] });
    // Half-open overlap: existing.checkIn < requested.checkOut AND existing.checkOut > requested.checkIn
    and.push({
      bookings: {
        none: { status: { in: [...ACTIVE_BOOKING_STATUSES] }, checkIn: { lt: checkOut }, checkOut: { gt: checkIn } },
      },
    });
    and.push({ blockedDates: { none: { startDate: { lt: checkOut }, endDate: { gt: checkIn } } } });
    and.push({ availability: { none: { date: { gte: checkIn, lt: checkOut }, isAvailable: false } } });
  }

  return { AND: and };
}

export function sortResults(results: PropertyCardData[], sort: SortOption): PropertyCardData[] {
  const price = (p: PropertyCardData) => p.stay?.totalCents ?? p.nightlyPriceCents;
  const drive = (p: PropertyCardData) => p.drive?.durationMinutes ?? Number.POSITIVE_INFINITY;
  // Bayesian-style rating so a single 5★ review doesn't outrank 40 reviews at 4.9.
  const score = (p: PropertyCardData) => {
    const prior = 4.5;
    const weight = 5;
    return ((p.ratingAverage ?? prior) * p.reviewCount + prior * weight) / (p.reviewCount + weight);
  };

  const sorted = [...results];
  switch (sort) {
    case "price_asc":
      return sorted.sort((a, b) => price(a) - price(b));
    case "price_desc":
      return sorted.sort((a, b) => price(b) - price(a));
    case "drive_asc":
      return sorted.sort((a, b) => drive(a) - drive(b));
    case "rating":
      return sorted.sort((a, b) => score(b) - score(a));
    case "recommended":
    default:
      // Balance quality against travel time: each hour of driving costs ~0.1 of a star.
      return sorted.sort((a, b) => score(b) - drive(b) / 600 - (score(a) - drive(a) / 600));
  }
}
