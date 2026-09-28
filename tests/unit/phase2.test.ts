import { describe, expect, it } from "vitest";
import { pageWindow } from "@/components/ui/pagination";
import { profileSchema } from "@/lib/validation/account";
import { countActiveFilters, parseSearchParams, toSearchQuery } from "@/lib/validation/search";
import { approximateLocation } from "@/server/services/drive-time";
import { paginate, sortResults } from "@/server/services/search-query";

describe("search params (Phase 2)", () => {
  it("uses ?destination= and still accepts the legacy ?to=", () => {
    expect(parseSearchParams({ destination: "hunter-valley" }).destination).toBe("hunter-valley");
    expect(parseSearchParams({ to: "kiama" }).destination).toBe("kiama");
    expect(parseSearchParams({ destination: "hunter-valley", to: "kiama" }).destination).toBe("hunter-valley");
    expect(toSearchQuery(parseSearchParams({ to: "kiama" }))).toContain("destination=kiama");
  });

  it("accepts ?guests= as shorthand for adults", () => {
    expect(parseSearchParams({ guests: "3" })).toMatchObject({ adults: 3, guests: 3 });
    expect(parseSearchParams({ guests: "3", adults: "2" }).adults).toBe(2);
  });

  it("validates page and drops it from canonical links on page 1", () => {
    expect(parseSearchParams({ page: "3" }).page).toBe(3);
    expect(parseSearchParams({ page: "-1" }).page).toBe(1);
    expect(parseSearchParams({ page: "abc" }).page).toBe(1);
    expect(parseSearchParams({ page: "999999" }).page).toBe(1);
    expect(toSearchQuery(parseSearchParams({ page: "1" }))).not.toContain("page=");
    expect(toSearchQuery(parseSearchParams({ page: "2" }))).toContain("page=2");
  });

  it("treats empty form fields as absent (regression: ?maxPrice= became $0)", () => {
    const p = parseSearchParams({ destination: "hunter-valley", drive: "", maxPrice: "", minPrice: "", bedrooms: "", checkIn: "", checkOut: "", adults: "2", children: "0", type: [""] });
    expect(p.maxPrice).toBeUndefined();
    expect(p.minPrice).toBeUndefined();
    expect(p.bedrooms).toBeUndefined();
    expect(p.drive).toBeUndefined();
    expect(p.type).toEqual([]);
    expect(p.destination).toBe("hunter-valley");
  });

  it("caps total guests", () => {
    const p = parseSearchParams({ adults: "16", children: "5" });
    expect(p.guests).toBe(16);
  });

  it("counts only user-chosen refinements", () => {
    expect(countActiveFilters(parseSearchParams({ destination: "kiama", checkIn: "2026-11-01", checkOut: "2026-11-03" }))).toBe(0);
    expect(countActiveFilters(parseSearchParams({ minPrice: "100", amenities: "pool,spa", type: "CABIN" }))).toBe(4);
  });
});

describe("paginate", () => {
  const items = Array.from({ length: 25 }, (_, i) => i + 1);

  it("slices pages and reports totals", () => {
    expect(paginate(items, 1, 12)).toEqual({ items: items.slice(0, 12), info: { page: 1, pageSize: 12, totalResults: 25, totalPages: 3 } });
    expect(paginate(items, 3, 12).items).toEqual([25]);
  });

  it("clamps out-of-range pages", () => {
    expect(paginate(items, 99, 12).info.page).toBe(3);
    expect(paginate(items, 0, 12).info.page).toBe(1);
  });

  it("handles empty results", () => {
    expect(paginate([], 4, 12)).toEqual({ items: [], info: { page: 1, pageSize: 12, totalResults: 0, totalPages: 1 } });
  });
});

describe("pageWindow", () => {
  it("shows first, last and neighbours with gaps", () => {
    expect(pageWindow(1, 3)).toEqual([1, 2, 3]);
    expect(pageWindow(5, 10)).toEqual([1, null, 4, 5, 6, null, 10]);
    expect(pageWindow(10, 10)).toEqual([1, null, 9, 10]);
  });
});

describe("sortResults determinism", () => {
  const item = (id: string, price: number) => ({ id, nightlyPriceCents: price, drive: null, ratingAverage: null, reviewCount: 0 });
  it("breaks ties by id so page boundaries are stable", () => {
    const a = sortResults([item("c", 100), item("a", 100), item("b", 100)], "price_asc").map((r) => r.id);
    const b = sortResults([item("b", 100), item("c", 100), item("a", 100)], "price_asc").map((r) => r.id);
    expect(a).toEqual(["a", "b", "c"]);
    expect(b).toEqual(a);
  });
});

describe("approximateLocation (privacy)", () => {
  it("rounds coordinates to ~1 km", () => {
    expect(approximateLocation({ latitude: -32.759123, longitude: 151.369876 })).toEqual({ latitude: -32.76, longitude: 151.37 });
  });
});

describe("profile validation", () => {
  it("accepts a name and optional phone", () => {
    expect(profileSchema.parse({ name: " Sam Taylor ", phone: "" })).toEqual({ name: "Sam Taylor", phone: null });
    expect(profileSchema.parse({ name: "Sam", phone: "+61 412 345 678" }).phone).toBe("+61 412 345 678");
  });

  it("rejects invalid phones and blank names", () => {
    expect(profileSchema.safeParse({ name: "Sam", phone: "call me maybe" }).success).toBe(false);
    expect(profileSchema.safeParse({ name: "   ", phone: "" }).success).toBe(false);
    expect(profileSchema.safeParse({ name: "\u0000\u0001", phone: "" }).success).toBe(false);
  });

  it("does not accept email, role or other fields", () => {
    const parsed = profileSchema.parse({ name: "Sam", phone: "", email: "x@y.z", role: "ADMIN", id: "someone-else" });
    expect(Object.keys(parsed).sort()).toEqual(["name", "phone"]);
  });
});
