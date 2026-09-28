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
  OTHER: "Other",
};

export const SORT_OPTIONS = [
  { value: "recommended", label: "Recommended" },
  { value: "drive_asc", label: "Shortest drive" },
  { value: "price_asc", label: "Price: low to high" },
  { value: "price_desc", label: "Price: high to low" },
  { value: "rating", label: "Top rated" },
] as const;
export type SortOption = (typeof SORT_OPTIONS)[number]["value"];

export const MAX_GUESTS = 16;
export const SEARCH_PAGE_SIZE = 48;
