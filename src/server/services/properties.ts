import "server-only";
import { cache } from "react";
import { AMENITIES } from "@/config/amenities";
import { DEFAULT_ORIGIN_SLUG } from "@/config/search";
import { haversineMeters } from "@/lib/geo";
import { prisma } from "@/server/db";
import { demoListingsVisible } from "@/server/env";
import type { DriveInfo } from "@/types/marketplace";
import { approximateLocation, resolvePropertyDrive } from "./drive-time";
import { publicVisibilityConditions } from "./search-query";

/** Approximate-area radius shown on the property map before booking. */
export const PUBLIC_AREA_RADIUS_METERS = 1500;

/**
 * Public property detail. Returns null for anything not publicly visible (unpublished, paused,
 * suspended, or demo data when demo listings are hidden) so callers can render a 404.
 *
 * Privacy: the street address and exact coordinates are never returned — only the locality and a
 * rounded position (see approximateLocation).
 */
export const getPublicProperty = cache(async (slug: string, userId?: string | null) => {
  const property = await prisma.property.findFirst({
    where: { AND: [{ slug }, ...publicVisibilityConditions(demoListingsVisible())] },
    select: {
      id: true,
      slug: true,
      title: true,
      summary: true,
      description: true,
      type: true,
      locality: true,
      adminArea: true,
      countryCode: true,
      latitude: true,
      longitude: true,
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
      favourites: userId ? { where: { userId }, select: { userId: true } } : false,
    },
  });
  if (!property) return null;

  const [origin, ratingBreakdown, experiences] = await Promise.all([
    prisma.destination.findFirst({
      where: { slug: DEFAULT_ORIGIN_SLUG, isOrigin: true },
      select: {
        name: true,
        latitude: true,
        longitude: true,
        estimatesFrom: {
          where: { destinationId: property.destination.id },
          take: 1,
          select: { durationMinutes: true, distanceMeters: true, source: true },
        },
      },
    }),
    prisma.review.aggregate({
      where: { propertyId: property.id, status: "PUBLISHED" },
      _avg: { overallRating: true, cleanlinessRating: true, locationRating: true, valueRating: true, communicationRating: true },
      _count: true,
    }),
    prisma.experience.findMany({
      where: { destinationId: property.destination.id, status: "PUBLISHED" },
      select: { id: true, title: true, category: true, summary: true, latitude: true, longitude: true, isDemo: true },
      take: 12,
    }),
  ]);

  const drive: DriveInfo | null = origin
    ? resolvePropertyDrive(origin, origin.estimatesFrom[0], property.destination, property)
    : null;

  const order = new Map(AMENITIES.map((a, i) => [a.key, i]));
  const amenities = property.amenities
    .map((a) => a.amenity)
    .sort((a, b) => (order.get(a.key) ?? 99) - (order.get(b.key) ?? 99));

  // Straight-line distance from the property's area, rounded — labelled approximate in the UI.
  const nearby = experiences
    .map((e) => ({
      ...e,
      distanceKm:
        e.latitude !== null && e.longitude !== null
          ? Math.max(1, Math.round(haversineMeters(property, { latitude: e.latitude, longitude: e.longitude }) / 1000))
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
  const { favourites, latitude, longitude, ...rest } = property;
  return {
    ...rest,
    area: approximateLocation({ latitude, longitude }),
    amenities,
    reviews: property.reviews.map(({ author, ...r }) => ({ ...r, authorName: shortName(author.name) })),
    categoryRatings,
    nearby,
    isFavourite: (favourites?.length ?? 0) > 0,
    drive,
  };
});

export type PublicProperty = NonNullable<Awaited<ReturnType<typeof getPublicProperty>>>;

/** Show first name + initial only. */
export function shortName(name: string): string {
  const [first, last] = name.trim().split(/\s+/);
  return last ? `${first} ${last[0]}.` : (first ?? "Guest");
}
