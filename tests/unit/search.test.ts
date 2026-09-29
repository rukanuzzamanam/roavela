import { describe, expect, it } from "vitest";
import { parseSearchParams, toSearchQuery } from "@/lib/validation/search";
import { buildPropertyWhere, sortResults } from "@/server/services/search-query";
import type { PropertyCardData } from "@/types/marketplace";

describe("parseSearchParams", () => {
  it("applies sensible defaults", () => {
    const p = parseSearchParams({});
    expect(p).toMatchObject({ from: "sydney", adults: 2, children: 0, guests: 2, sort: "recommended", view: "list", type: [], amenities: [] });
    expect(p.stay).toBeUndefined();
  });

  it("drops invalid values instead of failing", () => {
    const p = parseSearchParams({
      from: "<script>",
      drive: "99",
      adults: "-3",
      minPrice: "abc",
      type: "CABIN,CASTLE",
      amenities: ["pool", "drop table", "pool"],
      sort: "hacker",
    });
    expect(p.from).toBe("sydney");
    expect(p.drive).toBeUndefined();
    expect(p.adults).toBe(2);
    expect(p.minPrice).toBeUndefined();
    expect(p.type).toEqual(["CABIN"]);
    expect(p.amenities).toEqual(["pool"]);
    expect(p.sort).toBe("recommended");
  });

  it("accepts a valid stay and ignores reversed or impossible dates", () => {
    expect(parseSearchParams({ checkIn: "2026-10-16", checkOut: "2026-10-18" }).stay?.nights).toBe(2);
    const reversed = parseSearchParams({ checkIn: "2026-10-18", checkOut: "2026-10-16" });
    expect(reversed.stay).toBeUndefined();
    expect(reversed.checkIn).toBeUndefined();
    expect(parseSearchParams({ checkIn: "2026-02-30", checkOut: "2026-03-02" }).stay).toBeUndefined();
    expect(parseSearchParams({ checkIn: "2026-01-01", checkOut: "2026-12-31" }).stay).toBeUndefined(); // > 60 nights
  });

  it("swaps an inverted price range", () => {
    const p = parseSearchParams({ minPrice: "500", maxPrice: "200" });
    expect([p.minPrice, p.maxPrice]).toEqual([200, 500]);
  });

  it("expands collection presets server-side, letting explicit filters win", () => {
    const romantic = parseSearchParams({ collection: "romantic-escapes" });
    expect(romantic.anyAmenities).toEqual(["spa", "fireplace"]);
    expect(romantic.maxBedrooms).toBe(2);

    const weekend = parseSearchParams({ collection: "weekend-escapes", drive: "2" });
    expect(weekend.drive).toBe(2);

    expect(parseSearchParams({ collection: "not-a-collection" }).collection).toBeUndefined();
  });

  it("round-trips through toSearchQuery", () => {
    const p = parseSearchParams({ from: "sydney", drive: "3", checkIn: "2026-10-16", checkOut: "2026-10-18", adults: "4", amenities: "pool,spa" });
    const again = parseSearchParams(Object.fromEntries(new URLSearchParams(toSearchQuery(p))));
    expect(again).toEqual(p);
  });
});

describe("buildPropertyWhere", () => {
  const ctx = { originId: "origin_1", includeDemo: true };
  const conditions = (params: ReturnType<typeof parseSearchParams>, c = ctx) =>
    buildPropertyWhere(params, c).AND as Record<string, unknown>[];

  it("only ever returns PUBLISHED listings", () => {
    expect(conditions(parseSearchParams({}))).toContainEqual({ status: "PUBLISHED" });
  });

  it("excludes demo listings when they are hidden", () => {
    expect(conditions(parseSearchParams({}), { ...ctx, includeDemo: false })).toContainEqual({ isDemo: false });
    expect(conditions(parseSearchParams({}))).not.toContainEqual({ isDemo: false });
  });

  it("requires capacity for all guests", () => {
    expect(conditions(parseSearchParams({ adults: "3", children: "2" }))).toContainEqual({ maxGuests: { gte: 5 } });
  });

  it("checks availability with half-open overlap against active bookings and blocks", () => {
    const p = parseSearchParams({ checkIn: "2026-10-16", checkOut: "2026-10-18" });
    const c = conditions(p);
    const checkIn = new Date("2026-10-16T00:00:00Z");
    const checkOut = new Date("2026-10-18T00:00:00Z");
    // Phase 4: a PENDING booking only blocks while its checkout hold is live.
    const bookingRule = c.find((x) => "bookings" in x) as { bookings: { none: Record<string, unknown> } };
    expect(bookingRule.bookings.none).toMatchObject({ checkIn: { lt: checkOut }, checkOut: { gt: checkIn } });
    expect(bookingRule.bookings.none.OR).toEqual([{ status: "CONFIRMED" }, { status: "PENDING", expiresAt: { gt: expect.any(Date) } }]);
    expect(c).toContainEqual({ blockedDates: { none: { startDate: { lt: checkOut }, endDate: { gt: checkIn } } } });
    expect(c).toContainEqual({ minNights: { lte: 2 } });
  });

  it("filters by drive time from the origin using stored estimates", () => {
    const c = conditions(parseSearchParams({ drive: "2" }));
    expect(c).toContainEqual({
      destination: { estimatesTo: { some: { originId: "origin_1", durationMinutes: { lte: 120 } } } },
    });
  });

  it("requires every selected amenity", () => {
    const c = conditions(parseSearchParams({ amenities: "pool,pet_friendly" }));
    expect(c).toContainEqual({ amenities: { some: { amenity: { key: "pool" } } } });
    expect(c).toContainEqual({ amenities: { some: { amenity: { key: "pet_friendly" } } } });
  });
});

describe("sortResults", () => {
  const card = (id: string, over: Partial<PropertyCardData>): PropertyCardData => ({
    id,
    slug: id,
    title: id,
    type: "CABIN",
    locality: "",
    destinationName: "",
    destinationSlug: "",
    imageUrl: null,
    imageAlt: "",
    currency: "AUD",
    nightlyPriceCents: 20_000,
    ratingAverage: 4.8,
    reviewCount: 10,
    maxGuests: 2,
    bedrooms: 1,
    bathrooms: 1,
    highlights: [],
    drive: { originName: "Sydney", durationMinutes: 120, distanceMeters: 1, approximate: true },
    latitude: 0,
    longitude: 0,
    isDemo: true,
    isFavourite: false,
    ...over,
  });

  it("sorts by price, using the stay total when dates are set", () => {
    const a = card("a", { nightlyPriceCents: 30_000 });
    const b = card("b", { nightlyPriceCents: 10_000 });
    expect(sortResults([a, b], "price_asc").map((r) => r.id)).toEqual(["b", "a"]);
    const c = card("c", { nightlyPriceCents: 10_000, stay: { nights: 2, totalCents: 90_000 } });
    const d = card("d", { nightlyPriceCents: 30_000, stay: { nights: 2, totalCents: 70_000 } });
    expect(sortResults([c, d], "price_asc").map((r) => r.id)).toEqual(["d", "c"]);
  });

  it("sorts by drive time", () => {
    const near = card("near", { drive: { originName: "Sydney", durationMinutes: 90, distanceMeters: 1, approximate: true } });
    const far = card("far", { drive: { originName: "Sydney", durationMinutes: 170, distanceMeters: 1, approximate: true } });
    expect(sortResults([far, near], "drive_asc").map((r) => r.id)).toEqual(["near", "far"]);
  });

  it("does not let a single 5★ review outrank a well-reviewed 4.9", () => {
    const one = card("one", { ratingAverage: 5, reviewCount: 1 });
    const many = card("many", { ratingAverage: 4.9, reviewCount: 40 });
    expect(sortResults([one, many], "rating").map((r) => r.id)).toEqual(["many", "one"]);
  });
});
