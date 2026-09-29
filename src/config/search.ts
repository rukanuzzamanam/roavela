import type { PropertyType } from "@/generated/prisma/enums";

export const DEFAULT_ORIGIN_SLUG = "sydney";

export const DRIVE_TIME_OPTIONS = [1, 2, 3, 4, 5] as const;
export type DriveHours = (typeof DRIVE_TIME_OPTIONS)[number];

export const PROPERTY_TYPE_LABELS: Record<PropertyType, string> = {
  CABIN: "Cabin",
  COTTAGE: "Cottage",
  BEACH_HOUSE: "Beach house",
  APARTMENT: "Apartment",
  FARM_STAY: "Farm stay",
  TINY_HOME: "Tiny home",
  FAMILY_HOUSE: "Family house",
  VILLA: "Villa",
  GLAMPING: "Glamping",
  HOUSE: "House",
  GUESTHOUSE: "Guesthouse",
  OTHER: "Other",
};

export const SORT_OPTIONS = [
  { value: "recommended", label: "Recommended" },
  { value: "price_asc", label: "Price: low to high" },
  { value: "price_desc", label: "Price: high to low" },
  { value: "rating", label: "Top rated" },
  // Drive times are estimates until a routing provider is configured — the label says so.
  { value: "drive_asc", label: "Shortest drive (est.)" },
] as const;
export type SortOption = (typeof SORT_OPTIONS)[number]["value"];

export const MAX_GUESTS = 16;
/** Results per page. */
export const SEARCH_PAGE_SIZE = 12;
export const MAX_SEARCH_PAGE = 500;
/**
 * Upper bound on candidates ranked per query. Ranking (drive-time refinement, rating smoothing)
 * runs on lightweight sort keys server-side; beyond this size ranking should move into SQL.
 */
export const MAX_SEARCH_CANDIDATES = 2000;
