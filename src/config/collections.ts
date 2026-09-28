import type { PropertyType } from "@/generated/prisma/enums";
import type { SortOption } from "./search";

/**
 * Curated collections shown on the homepage. Each is a preset of search filters, applied
 * server-side via `/search?collection=<slug>` so URLs stay short and presets stay editable here.
 */
export interface CollectionPreset {
  slug: string;
  title: string;
  description: string;
  maxDriveHours?: number;
  types?: PropertyType[];
  /** Property must have ALL of these amenities. */
  amenities?: string[];
  /** Property must have AT LEAST ONE of these amenities. */
  anyAmenities?: string[];
  maxBedrooms?: number;
  sort?: SortOption;
}

export const COLLECTIONS: readonly CollectionPreset[] = [
  {
    slug: "weekend-escapes",
    title: "Weekend escapes",
    description: "Leave Friday afternoon, arrive before dinner.",
    maxDriveHours: 3,
    sort: "recommended",
  },
  {
    slug: "popular-nearby",
    title: "Popular close to home",
    description: "Guest favourites under two hours away.",
    maxDriveHours: 2,
    sort: "rating",
  },
  {
    slug: "cabins-cottages",
    title: "Cabins & cottages",
    description: "Fireside nights and slow mornings.",
    types: ["CABIN", "COTTAGE"],
  },
  {
    slug: "family-escapes",
    title: "Family escapes",
    description: "Room to spread out, things for the kids to do.",
    amenities: ["family_friendly"],
  },
  {
    slug: "romantic-escapes",
    title: "Romantic escapes",
    description: "Spas, fireplaces and space for two.",
    anyAmenities: ["spa", "fireplace"],
    maxBedrooms: 2,
  },
  {
    slug: "beach-stays",
    title: "Beach stays",
    description: "Salt air and sandy feet.",
    amenities: ["beach"],
  },
  {
    slug: "pet-friendly",
    title: "Pet-friendly stays",
    description: "Bring the whole family — four legs included.",
    amenities: ["pet_friendly"],
  },
  {
    slug: "unique-stays",
    title: "Unique stays",
    description: "Tiny homes, farm stays and places with a story.",
    types: ["TINY_HOME", "FARM_STAY", "GLAMPING"],
  },
] as const;

export const COLLECTION_BY_SLUG = new Map(COLLECTIONS.map((c) => [c.slug, c]));
