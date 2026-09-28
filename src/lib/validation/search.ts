import { z } from "zod";
import { AMENITY_KEYS } from "@/config/amenities";
import { COLLECTION_BY_SLUG } from "@/config/collections";
import { DEFAULT_ORIGIN_SLUG, MAX_GUESTS, MAX_SEARCH_PAGE, SORT_OPTIONS, type SortOption } from "@/config/search";
import { PropertyType } from "@/generated/prisma/enums";
import { isIsoDate, nightsBetween, parseIsoDate } from "@/lib/dates";

/**
 * Search parameters arrive from the URL, so every field degrades gracefully: invalid values are
 * dropped (`.catch`) rather than failing the whole page.
 *
 * Canonical URL keys: from, destination, drive, checkIn, checkOut, adults, children, minPrice,
 * maxPrice, bedrooms, bathrooms, type, amenities, collection, sort, view, page.
 * Accepted aliases: `to` (→ destination), `guests` (→ adults, when adults is absent).
 */

type RawParams = Record<string, string | string[] | undefined>;

const slug = z.string().trim().toLowerCase().regex(/^[a-z0-9-]{1,80}$/);
const intInRange = (min: number, max: number) => z.coerce.number().int().min(min).max(max);
const toArray = (v: unknown) => (v === undefined ? [] : Array.isArray(v) ? v : String(v).split(","));
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

const propertyTypes = Object.values(PropertyType) as [PropertyType, ...PropertyType[]];
const sortValues = SORT_OPTIONS.map((s) => s.value) as [SortOption, ...SortOption[]];

const rawSchema = z.object({
  from: slug.catch(DEFAULT_ORIGIN_SLUG).default(DEFAULT_ORIGIN_SLUG),
  destination: slug.optional().catch(undefined),
  drive: intInRange(1, 12).optional().catch(undefined),
  checkIn: z.string().refine(isIsoDate).optional().catch(undefined),
  checkOut: z.string().refine(isIsoDate).optional().catch(undefined),
  adults: intInRange(1, MAX_GUESTS).catch(2).default(2),
  children: intInRange(0, MAX_GUESTS).catch(0).default(0),
  minPrice: intInRange(0, 100_000).optional().catch(undefined),
  maxPrice: intInRange(0, 100_000).optional().catch(undefined),
  bedrooms: intInRange(0, 20).optional().catch(undefined),
  bathrooms: intInRange(0, 20).optional().catch(undefined),
  type: z.preprocess(toArray, z.array(z.string())).transform((vals) =>
    vals.filter((v): v is PropertyType => (propertyTypes as string[]).includes(v)),
  ),
  amenities: z.preprocess(toArray, z.array(z.string())).transform((vals) =>
    [...new Set(vals.filter((v) => AMENITY_KEYS.includes(v)))],
  ),
  collection: z.string().optional().transform((v) => (v && COLLECTION_BY_SLUG.has(v) ? v : undefined)).catch(undefined),
  sort: z.enum(sortValues).catch("recommended").default("recommended"),
  view: z.enum(["list", "map"]).catch("list").default("list"),
  page: intInRange(1, MAX_SEARCH_PAGE).catch(1).default(1),
});

export type SearchParams = z.infer<typeof rawSchema> & {
  /** Parsed, validated date range (only present when both dates are valid and ordered). */
  stay?: { checkIn: Date; checkOut: Date; nights: number };
  guests: number;
  /** Internal-only filters sourced from collection presets. */
  anyAmenities: string[];
  maxBedrooms?: number;
};

export const MAX_STAY_NIGHTS = 60;

/** Treat empty form fields (`?maxPrice=`) as absent — otherwise coercion would turn "" into 0. */
function dropEmpty(raw: RawParams): RawParams {
  const out: RawParams = {};
  for (const [key, value] of Object.entries(raw)) {
    const cleaned = Array.isArray(value) ? value.filter((v) => v.trim() !== "") : value;
    if (cleaned === undefined || (typeof cleaned === "string" && cleaned.trim() === "") || (Array.isArray(cleaned) && cleaned.length === 0)) continue;
    out[key] = cleaned;
  }
  return out;
}

export function parseSearchParams(input: RawParams): SearchParams {
  const raw = dropEmpty(input);
  const normalised: RawParams = {
    ...raw,
    destination: raw.destination ?? raw.to,
    adults: raw.adults ?? first(raw.guests),
  };
  const parsed = rawSchema.parse(normalised);
  if (parsed.adults + parsed.children > MAX_GUESTS) parsed.children = Math.max(0, MAX_GUESTS - parsed.adults);
  const result: SearchParams = { ...parsed, guests: parsed.adults + parsed.children, anyAmenities: [] };

  if (parsed.checkIn && parsed.checkOut) {
    const checkIn = parseIsoDate(parsed.checkIn);
    const checkOut = parseIsoDate(parsed.checkOut);
    const nights = nightsBetween(checkIn, checkOut);
    if (nights >= 1 && nights <= MAX_STAY_NIGHTS) {
      result.stay = { checkIn, checkOut, nights };
    }
  }
  if (!result.stay) {
    result.checkIn = undefined;
    result.checkOut = undefined;
  }

  if (result.minPrice !== undefined && result.maxPrice !== undefined && result.minPrice > result.maxPrice) {
    [result.minPrice, result.maxPrice] = [result.maxPrice, result.minPrice];
  }

  // Apply a collection preset. Explicit URL filters take precedence.
  const preset = result.collection ? COLLECTION_BY_SLUG.get(result.collection) : undefined;
  if (preset) {
    result.drive ??= preset.maxDriveHours;
    if (result.type.length === 0 && preset.types) result.type = [...preset.types];
    if (preset.amenities) result.amenities = [...new Set([...result.amenities, ...preset.amenities])];
    result.anyAmenities = preset.anyAmenities ? [...preset.anyAmenities] : [];
    result.maxBedrooms = preset.maxBedrooms;
    if (raw.sort === undefined && preset.sort) result.sort = preset.sort;
  }

  return result;
}

/** Number of user-chosen refinements (excludes where/when/who). */
export function countActiveFilters(p: SearchParams): number {
  return (
    p.type.length +
    p.amenities.length +
    [p.minPrice, p.maxPrice, p.bedrooms, p.bathrooms].filter((v) => v !== undefined).length
  );
}

/**
 * Serialise search params back into a canonical query string. `page` is omitted unless > 1, so
 * any link built from changed filters naturally resets to the first page.
 */
export function toSearchQuery(params: Partial<SearchParams>, overrides: Record<string, string | undefined> = {}): string {
  const q = new URLSearchParams();
  const set = (k: string, v: string | number | undefined) => {
    if (v !== undefined && v !== "") q.set(k, String(v));
  };
  set("from", params.from);
  set("destination", params.destination);
  set("drive", params.drive);
  set("checkIn", params.checkIn);
  set("checkOut", params.checkOut);
  set("adults", params.adults);
  if (params.children) set("children", params.children);
  set("minPrice", params.minPrice);
  set("maxPrice", params.maxPrice);
  set("bedrooms", params.bedrooms);
  set("bathrooms", params.bathrooms);
  if (params.type?.length) set("type", params.type.join(","));
  if (params.amenities?.length) set("amenities", params.amenities.join(","));
  set("collection", params.collection);
  if (params.sort && params.sort !== "recommended") set("sort", params.sort);
  if (params.view && params.view !== "list") set("view", params.view);
  if (params.page && params.page > 1) set("page", params.page);
  for (const [k, v] of Object.entries(overrides)) {
    if (v === undefined) q.delete(k);
    else q.set(k, v);
  }
  return q.toString();
}
