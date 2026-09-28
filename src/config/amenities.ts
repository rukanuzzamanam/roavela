import type { AmenityCategory } from "@/generated/prisma/enums";

export interface AmenityDefinition {
  key: string;
  label: string;
  category: AmenityCategory;
  icon: string;
  /** Shown on property cards when present. */
  highlight?: boolean;
}

/**
 * Canonical amenity catalogue. The seed script upserts these into the Amenity table, and search
 * filters validate against these keys — this is the single source of truth.
 */
export const AMENITIES: readonly AmenityDefinition[] = [
  { key: "wifi", label: "Wi-Fi", category: "ESSENTIALS", icon: "wifi" },
  { key: "kitchen", label: "Kitchen", category: "ESSENTIALS", icon: "kitchen" },
  { key: "parking", label: "Free parking", category: "ESSENTIALS", icon: "car" },
  { key: "air_conditioning", label: "Air conditioning", category: "ESSENTIALS", icon: "snow" },
  { key: "washer", label: "Washing machine", category: "ESSENTIALS", icon: "washer" },
  { key: "pool", label: "Pool", category: "FEATURES", icon: "pool", highlight: true },
  { key: "spa", label: "Spa", category: "FEATURES", icon: "spa", highlight: true },
  { key: "fireplace", label: "Fireplace", category: "FEATURES", icon: "flame", highlight: true },
  { key: "ev_charging", label: "EV charging", category: "FEATURES", icon: "plug", highlight: true },
  { key: "bbq", label: "BBQ", category: "OUTDOOR", icon: "grill" },
  { key: "fire_pit", label: "Fire pit", category: "OUTDOOR", icon: "flame" },
  { key: "pet_friendly", label: "Pet friendly", category: "FAMILY", icon: "paw", highlight: true },
  { key: "family_friendly", label: "Family friendly", category: "FAMILY", icon: "family", highlight: true },
  { key: "accessible", label: "Step-free access", category: "ACCESSIBILITY", icon: "accessible" },
  { key: "beach", label: "Near the beach", category: "SETTING", icon: "wave", highlight: true },
  { key: "mountain", label: "Mountain setting", category: "SETTING", icon: "mountain", highlight: true },
  { key: "vineyard", label: "Vineyard setting", category: "SETTING", icon: "grape", highlight: true },
  { key: "farm_stay", label: "Farm stay", category: "SETTING", icon: "tractor", highlight: true },
] as const;

export const AMENITY_KEYS = AMENITIES.map((a) => a.key);
export const AMENITY_BY_KEY = new Map(AMENITIES.map((a) => [a.key, a]));

/** Filters offered in the search UI, in display order. */
export const FILTER_AMENITY_KEYS = [
  "parking",
  "pet_friendly",
  "family_friendly",
  "pool",
  "spa",
  "fireplace",
  "ev_charging",
  "wifi",
  "air_conditioning",
  "kitchen",
  "accessible",
  "beach",
  "mountain",
  "vineyard",
  "farm_stay",
] as const;
