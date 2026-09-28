import type { PropertyType } from "@/generated/prisma/enums";

/**
 * Serializable DTOs passed from the server to UI components. Keep these free of database-only
 * fields (host contact details, exact addresses, internal notes).
 */

export interface DriveInfo {
  originName: string;
  durationMinutes: number;
  distanceMeters: number;
  /** Always true until a routing API is wired in. Drives "approx." labelling in the UI. */
  approximate: boolean;
}

export interface PropertyCardData {
  id: string;
  slug: string;
  title: string;
  type: PropertyType;
  locality: string;
  destinationName: string;
  destinationSlug: string;
  imageUrl: string | null;
  imageAlt: string;
  currency: string;
  nightlyPriceCents: number;
  ratingAverage: number | null;
  reviewCount: number;
  maxGuests: number;
  bedrooms: number;
  bathrooms: number;
  highlights: { key: string; label: string }[];
  drive: DriveInfo | null;
  latitude: number;
  longitude: number;
  isDemo: boolean;
  isFavourite: boolean;
  /** Present when the search included valid dates. */
  stay?: { nights: number; totalCents: number };
}

export interface OriginOption {
  slug: string;
  name: string;
}

export interface DestinationSummary {
  slug: string;
  name: string;
  tagline: string | null;
  heroImageUrl: string | null;
  drive: DriveInfo | null;
  stayCount: number;
}
