import "server-only";
import { cache } from "react";
import { AMENITIES } from "@/config/amenities";
import { DEFAULT_ORIGIN_SLUG } from "@/config/search";
import { estimateDriveHeuristic, estimatePropertyDrive } from "@/lib/geo";
import { prisma } from "@/server/db";
import { demoListingsVisible } from "@/server/env";
import type { DriveInfo } from "@/types/marketplace";

/**
 * Public property detail. Returns null for anything not publicly visible (unpublished, paused,
 * suspended, or demo data when demo listings are hidden) so callers can render a 404.
 * The exact street address is intentionally not included.
 */
export const getPublicProperty = cache(async (slug: string, userId?: string | null) => {
  const property = await prisma.property.findFirst({
    where: { slug, status: "PUBLISHED", ...(demoListingsVisible() ? {} : { isDemo: false }) },
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
      checkInTime: true,
      checkOutTime: true,
      houseRules: true,
      cancellationPolicy: true,
      ratingAverage: true,
      reviewCount: true,
      isDemo: true,
      host: { select: { displayName: true, createdAt: true } },
      destination: { select: { id: true, name: true, slug: true, latitude: true, longitude: true } },
      images: { select: { id: true, url: true, alt: true }, orderBy: { position: "asc" } },
      amenities: { select: { amenity: { select: { key: true, label: true, category: true } } } },
      reviews: {
        where: { status: "PUBLISHED" },
        orderBy: { createdAt: "desc" },
        take: 6,
        select: {
          id: true,
          overallRating: true,
          cleanlinessRating: true,
          locationRating: true,
          valueRating: true,
          communicationRating: true,
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

  const origin = await prisma.destination.findFirst({
    where: { slug: DEFAULT_ORIGIN_SLUG, isOrigin: true },
    select: {
      id: true,
      name: true,
      latitude: true,
      longitude: true,
      estimatesFrom: { where: { destinationId: property.destination.id }, take: 1, select: { durationMinutes: true, distanceMeters: true } },
    },
  });

  let drive: DriveInfo | null = null;
  if (origin) {
    const regional = origin.estimatesFrom[0];
    const estimate = regional
      ? estimatePropertyDrive(regional, property.destination, property)
      : estimateDriveHeuristic(origin, property);
    drive = { originName: origin.name, ...estimate, approximate: true };
  }

  const order = new Map(AMENITIES.map((a, i) => [a.key, i]));
  const amenities = property.amenities
    .map((a) => a.amenity)
    .sort((a, b) => (order.get(a.key) ?? 99) - (order.get(b.key) ?? 99));

  const { favourites, ...rest } = property;
  return {
    ...rest,
    amenities,
    // Show first name + initial only.
    reviews: property.reviews.map(({ author, ...r }) => ({ ...r, authorName: shortName(author.name) })),
    isFavourite: (favourites?.length ?? 0) > 0,
    drive,
  };
});

export type PublicProperty = NonNullable<Awaited<ReturnType<typeof getPublicProperty>>>;

function shortName(name: string): string {
  const [first, last] = name.trim().split(/\s+/);
  return last ? `${first} ${last[0]}.` : (first ?? "Guest");
}
