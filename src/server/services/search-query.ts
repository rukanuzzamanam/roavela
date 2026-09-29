import type { Prisma } from "@/generated/prisma/client";
import type { SortOption } from "@/config/search";
import type { SearchParams } from "@/lib/validation/search";

/**
 * Pure query-building, ranking and pagination for property search. Kept free of I/O so the rules
 * (what is searchable, how availability is checked, how results are ordered) are unit-testable.
 */

/** Bookings in these states hold the dates. Must match the DB exclusion constraint. */
export const ACTIVE_BOOKING_STATUSES = ["PENDING", "CONFIRMED"] as const;

/** Bookings that currently hold inventory: confirmed, or awaiting payment with a live hold. */
export function activeBookingWhere(now: Date = new Date()): Prisma.BookingWhereInput {
  return { OR: [{ status: "CONFIRMED" }, { status: "PENDING", expiresAt: { gt: now } }] };
}

export interface SearchContext {
  originId: string | null;
  includeDemo: boolean;
}

export interface StayRange {
  checkIn: Date;
  checkOut: Date;
  nights: number;
}

/**
 * Conditions a property must meet to be bookable for a date range. Shared by search and the
 * property page so both apply exactly the same availability rules.
 */
export function stayAvailabilityConditions({ checkIn, checkOut, nights }: StayRange, now: Date = new Date()): Prisma.PropertyWhereInput[] {
  return [
    { minNights: { lte: nights } },
    { OR: [{ maxNights: null }, { maxNights: { gte: nights } }] },
    // Half-open overlap: existing.checkIn < requested.checkOut AND existing.checkOut > requested.checkIn.
    // A PENDING booking only holds the dates while its checkout hold is live; lapsed holds are
    // ignored here (and marked EXPIRED before any new booking is inserted).
    {
      bookings: {
        none: {
          checkIn: { lt: checkOut },
          checkOut: { gt: checkIn },
          ...activeBookingWhere(now),
        },
      },
    },
    { blockedDates: { none: { startDate: { lt: checkOut }, endDate: { gt: checkIn } } } },
    { availability: { none: { date: { gte: checkIn, lt: checkOut }, isAvailable: false } } },
  ];
}

/** Only admin-approved, live listings are ever publicly visible. */
export function publicVisibilityConditions(includeDemo: boolean): Prisma.PropertyWhereInput[] {
  return includeDemo ? [{ status: "PUBLISHED" }] : [{ status: "PUBLISHED" }, { isDemo: false }];
}

export function buildPropertyWhere(params: SearchParams, ctx: SearchContext): Prisma.PropertyWhereInput {
  const and: Prisma.PropertyWhereInput[] = [...publicVisibilityConditions(ctx.includeDemo)];

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

  if (params.destination) {
    // Match the destination itself or any place nested beneath it.
    and.push({ destination: { OR: [{ slug: params.destination }, { parent: { slug: params.destination } }] } });
  }

  if (params.drive !== undefined && ctx.originId) {
    // Coarse filter on the stored region estimate; refined per property after the query.
    and.push({
      destination: { estimatesTo: { some: { originId: ctx.originId, durationMinutes: { lte: params.drive * 60 } } } },
    });
  }

  if (params.stay) and.push(...stayAvailabilityConditions(params.stay));

  return { AND: and };
}

/** The fields ranking needs. Satisfied by both lightweight candidates and full card DTOs. */
export interface SortKeys {
  id: string;
  nightlyPriceCents: number;
  stay?: { totalCents: number };
  drive: { durationMinutes: number } | null;
  ratingAverage: number | null;
  reviewCount: number;
}

export function sortResults<T extends SortKeys>(results: T[], sort: SortOption): T[] {
  const price = (p: T) => p.stay?.totalCents ?? p.nightlyPriceCents;
  const drive = (p: T) => p.drive?.durationMinutes ?? Number.POSITIVE_INFINITY;
  // Bayesian-style rating so a single 5★ review doesn't outrank 40 reviews at 4.9.
  const score = (p: T) => {
    const prior = 4.5;
    const weight = 5;
    return ((p.ratingAverage ?? prior) * p.reviewCount + prior * weight) / (p.reviewCount + weight);
  };
  // Stable tie-break on id keeps page boundaries deterministic across requests.
  const byId = (a: T, b: T) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

  const sorted = [...results];
  switch (sort) {
    case "price_asc":
      return sorted.sort((a, b) => price(a) - price(b) || byId(a, b));
    case "price_desc":
      return sorted.sort((a, b) => price(b) - price(a) || byId(a, b));
    case "drive_asc":
      return sorted.sort((a, b) => drive(a) - drive(b) || byId(a, b));
    case "rating":
      return sorted.sort((a, b) => score(b) - score(a) || byId(a, b));
    case "recommended":
    default:
      // Balance quality against travel time: each hour of driving costs ~0.1 of a star.
      return sorted.sort((a, b) => score(b) - drive(b) / 600 - (score(a) - drive(a) / 600) || byId(a, b));
  }
}

export interface PageInfo {
  page: number;
  pageSize: number;
  totalResults: number;
  totalPages: number;
}

/** Clamp the requested page into range and slice. Page numbers are 1-based. */
export function paginate<T>(items: T[], requestedPage: number, pageSize: number): { items: T[]; info: PageInfo } {
  const totalResults = items.length;
  const totalPages = Math.max(1, Math.ceil(totalResults / pageSize));
  const page = Math.min(Math.max(1, Math.floor(requestedPage)), totalPages);
  const start = (page - 1) * pageSize;
  return { items: items.slice(start, start + pageSize), info: { page, pageSize, totalResults, totalPages } };
}
