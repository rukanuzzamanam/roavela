import "server-only";
import { cache } from "react";
import { AMENITIES } from "@/config/amenities";
import { DEFAULT_ORIGIN_SLUG } from "@/config/search";
import type { Prisma } from "@/generated/prisma/client";
import { haversineMeters } from "@/lib/geo";
import { prisma } from "@/server/db";
import { demoListingsVisible } from "@/server/env";
import type { DriveInfo } from "@/types/marketplace";
import { approximateLocation, locateProperty, resolvePropertyDrive } from "./drive-time";
import { publicVisibilityConditions } from "./search-query";

/** Approximate-area radius shown on the property map before booking. */
export const PUBLIC_AREA_RADIUS_METERS = 1500;

/**
 * Fields a property detail page may show. The street address, postcode and exact coordinates are
 * deliberately NOT selected — they must never reach a public page.
 */
const detailSelect = {
  id: true,
  slug: true,
  title: true,
  summary: true,
  description: true,
  type: true,
  status: true,
  locality: true,
  adminArea: true,
  countryCode: true,
  latitude: true, // used server-side only, stripped before returning
  longitude: true, // used server-side only, stripped before returning
  bedrooms: true,
  beds: true,
  bathrooms: true,
  maxGuests: true,
  currency: true,
  nightlyPriceCents: true,
  weekendPriceCents: true,
  cleaningFeeCents: true,
  minNights: true,
  maxNights: true,
  checkInTime: true,
  checkOutTime: true,
  smokingAllowed: true,
  petsAllowed: true,
  eventsAllowed: true,
  quietHoursStart: true,
  quietHoursEnd: true,
  houseRules: true,
  cancellationPolicy: true,
  ratingAverage: true,
  reviewCount: true,
  isDemo: true,
  updatedAt: true,
  host: {
    select: {
      displayName: true,
      bio: true,
      avatarUrl: true,
      createdAt: true,
      isDemo: true,
      _count: { select: { properties: { where: { status: "PUBLISHED" } } } },
    },
  },
  destination: {
    select: { id: true, name: true, slug: true, adminArea: true, isPublished: true, latitude: true, longitude: true },
  },
  images: { select: { id: true, url: true, alt: true, width: true, height: true }, orderBy: { position: "asc" } },
  amenities: { select: { amenity: { select: { key: true, label: true, category: true } } } },
  reviews: {
    where: { status: "PUBLISHED" },
    orderBy: { createdAt: "desc" },
    take: 6,
    select: {
      id: true,
      overallRating: true,
      body: true,
      createdAt: true,
      isDemo: true,
      author: { select: { name: true } },
    },
  },
} satisfies Prisma.PropertySelect;

type DetailRow = Prisma.PropertyGetPayload<{ select: typeof detailSelect }>;

async function buildPropertyDetail(row: DetailRow, isFavourite: boolean) {
  const destinationId = row.destination?.id;
  const [origin, ratingBreakdown, experiences] = await Promise.all([
    prisma.destination.findFirst({
      where: { slug: DEFAULT_ORIGIN_SLUG, isOrigin: true },
      select: {
        name: true,
        latitude: true,
        longitude: true,
        estimatesFrom: destinationId
          ? { where: { destinationId }, take: 1, select: { durationMinutes: true, distanceMeters: true, source: true } }
          : false,
      },
    }),
    prisma.review.aggregate({
      where: { propertyId: row.id, status: "PUBLISHED" },
      _avg: { overallRating: true, cleanlinessRating: true, locationRating: true, valueRating: true, communicationRating: true },
      _count: true,
    }),
    destinationId
      ? prisma.experience.findMany({
          where: { destinationId, status: "PUBLISHED" },
          select: { id: true, title: true, category: true, summary: true, latitude: true, longitude: true, isDemo: true },
          take: 12,
        })
      : Promise.resolve([]),
  ]);

  const located = locateProperty(row, row.destination);
  const drive: DriveInfo | null =
    origin && located && row.destination
      ? resolvePropertyDrive(origin, origin.estimatesFrom?.[0], row.destination, located.point)
      : null;

  const order = new Map(AMENITIES.map((a, i) => [a.key, i]));
  const amenities = row.amenities
    .map((a) => a.amenity)
    .sort((a, b) => (order.get(a.key) ?? 99) - (order.get(b.key) ?? 99));

  // Straight-line distance from the property's area, rounded — labelled approximate in the UI.
  const nearby = experiences
    .map((e) => ({
      ...e,
      distanceKm:
        located && e.latitude !== null && e.longitude !== null
          ? Math.max(1, Math.round(haversineMeters(located.point, { latitude: e.latitude, longitude: e.longitude }) / 1000))
          : null,
    }))
    .sort((a, b) => (a.distanceKm ?? 999) - (b.distanceKm ?? 999))
    .slice(0, 6);

  const avg = ratingBreakdown._avg;
  const categoryRatings =
    ratingBreakdown._count > 0
      ? [
          { key: "cleanliness", label: "Cleanliness", value: avg.cleanlinessRating },
          { key: "location", label: "Location", value: avg.locationRating },
          { key: "value", label: "Value", value: avg.valueRating },
          { key: "communication", label: "Communication", value: avg.communicationRating },
        ].filter((c): c is { key: string; label: string; value: number } => c.value !== null)
      : [];

  // Strip exact coordinates; expose only the approximate area.
  const { latitude: _lat, longitude: _lng, ...rest } = row;
  void _lat;
  void _lng;
  return {
    ...rest,
    area: located ? approximateLocation(located.point) : null,
    amenities,
    reviews: row.reviews.map(({ author, ...r }) => ({ ...r, authorName: shortName(author.name) })),
    categoryRatings,
    nearby,
    isFavourite,
    drive,
  };
}

export type PropertyDetail = Awaited<ReturnType<typeof buildPropertyDetail>>;

/**
 * Public property detail. Returns null for anything not publicly visible (unpublished, paused,
 * suspended, or demo data when demo listings are hidden) so callers can render a 404.
 * Public listings are guaranteed complete by the Property_listable_complete_check constraint.
 */
export const getPublicProperty = cache(async (slug: string, userId?: string | null) => {
  const row = await prisma.property.findFirst({
    where: { AND: [{ slug }, ...publicVisibilityConditions(demoListingsVisible())] },
    select: detailSelect,
  });
  if (!row) return null;
  const isFavourite = userId
    ? (await prisma.favourite.count({ where: { userId, propertyId: row.id } })) > 0
    : false;
  return buildPropertyDetail(row, isFavourite);
});

/**
 * Owner-only preview of a listing in any state (e.g. a draft). Ownership is part of the query, so
 * another host's id simply returns null.
 */
export async function getHostPropertyPreview(propertyId: string, hostUserId: string) {
  const row = await prisma.property.findFirst({
    where: { id: propertyId, host: { userId: hostUserId } },
    select: detailSelect,
  });
  return row ? buildPropertyDetail(row, false) : null;
}

export type PublicProperty = PropertyDetail;

/** Show first name + initial only. */
export function shortName(name: string): string {
  const [first, last] = name.trim().split(/\s+/);
  return last ? `${first} ${last[0]}.` : (first ?? "Guest");
}
