/**
 * Phase 2 integration tests against a real PostgreSQL database. Every fixture lives under its own
 * destination and is removed afterwards, so seeded demo data never affects results.
 */
import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Session and demo-visibility are controlled per test; everything else is real.
vi.mock("@/server/auth/session", () => ({ getCurrentUser: vi.fn(async () => null) }));
vi.mock("@/server/env", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/env")>();
  return { ...actual, demoListingsVisible: vi.fn(() => true) };
});
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { parseIsoDate } from "@/lib/dates";
import { parseSearchParams } from "@/lib/validation/search";
import { updateProfile } from "@/server/actions/account";
import { setFavouriteAction } from "@/server/actions/favourites";
import { hashPassword, verifyPassword } from "@/server/auth/password";
import { getCurrentUser } from "@/server/auth/session";
import { hashToken } from "@/server/auth/tokens";
import { prisma } from "@/server/db";
import { demoListingsVisible } from "@/server/env";
import { setFavourite } from "@/server/services/favourites";
import { consumePasswordReset, inspectResetToken, issuePasswordReset } from "@/server/services/password-reset";
import { getPublicProperty } from "@/server/services/properties";
import { searchProperties } from "@/server/services/search";
import { getStayQuote } from "@/server/services/stay-quote";

const run = randomBytes(4).toString("hex");
const destSlug = `p2-dest-${run}`;
const ids: Record<string, string> = {};
let destinationId = "";
let hostUserId = "";
const userA = { id: "", email: `a-${run}@integration.test`, name: "Alex Integration", role: "CUSTOMER" as const };
const userB = { id: "", email: `b-${run}@integration.test`, name: "Blair Integration", role: "CUSTOMER" as const };

const asUser = (u: typeof userA | null) => vi.mocked(getCurrentUser).mockResolvedValue(u);
const search = (q: Record<string, string>, pageSize?: number) =>
  searchProperties(parseSearchParams({ destination: destSlug, ...q }), { pageSize });

beforeAll(async () => {
  // Amenity catalogue rows (idempotent — they normally come from the seed).
  for (const [key, label] of [["pool", "Pool"], ["spa", "Spa"], ["pet_friendly", "Pet friendly"]] as const) {
    await prisma.amenity.upsert({ where: { key }, create: { key, label, category: "FEATURES" }, update: {} });
  }
  const amenity = Object.fromEntries((await prisma.amenity.findMany({ where: { key: { in: ["pool", "spa", "pet_friendly"] } } })).map((a) => [a.key, a.id]));

  destinationId = (
    await prisma.destination.create({
      data: { slug: destSlug, name: "Phase 2 Test Region", kind: "REGION", countryCode: "AU", latitude: -33, longitude: 150.5, timezone: "Australia/Sydney", isPublished: true },
    })
  ).id;
  const host = await prisma.user.create({
    data: { email: `host-${run}@integration.test`, name: "P2 Host", role: "HOST", hostProfile: { create: { displayName: "P2 Host" } } },
    include: { hostProfile: true },
  });
  hostUserId = host.id;

  const base = {
    hostId: host.hostProfile!.id,
    destinationId,
    summary: "Fixture",
    description: "Fixture",
    type: "CABIN" as const,
    addressLine1: "Private address",
    locality: "Testville",
    countryCode: "AU",
    timezone: "Australia/Sydney",
    bedrooms: 2,
    beds: 2,
    bathrooms: 1,
  };
  // 12 published, non-demo listings with prices 100..210 and varied capacity/amenities.
  for (let i = 0; i < 12; i++) {
    const p = await prisma.property.create({
      data: {
        ...base,
        slug: `p2-${run}-${i}`,
        title: `Fixture ${String(i).padStart(2, "0")}`,
        status: "PUBLISHED",
        latitude: -33.012345 + i * 0.001,
        longitude: 150.512345,
        maxGuests: i < 6 ? 2 : 6,
        nightlyPriceCents: 10_000 + i * 1_000,
        cleaningFeeCents: 5_000,
        ratingAverage: i % 3 === 0 ? 4.9 : 4.2,
        reviewCount: i % 3 === 0 ? 30 : 3,
        publishedAt: new Date(),
        amenities: {
          create: [
            ...(i % 2 === 0 ? [{ amenityId: amenity.pool! }] : []),
            ...(i % 4 === 0 ? [{ amenityId: amenity.spa! }] : []),
          ],
        },
      },
    });
    ids[`p${i}`] = p.id;
  }
  ids.demo = (await prisma.property.create({ data: { ...base, slug: `p2-${run}-demo`, title: "Demo fixture", status: "PUBLISHED", isDemo: true, latitude: -33, longitude: 150.5, maxGuests: 2, nightlyPriceCents: 9_000, amenities: { create: [{ amenityId: amenity.pet_friendly! }] } } })).id;
  ids.pending = (await prisma.property.create({ data: { ...base, slug: `p2-${run}-pending`, title: "Pending fixture", status: "PENDING_REVIEW", latitude: -33, longitude: 150.5, maxGuests: 2, nightlyPriceCents: 9_000 } })).id;

  userA.id = (await prisma.user.create({ data: { email: userA.email, name: userA.name, passwordHash: await hashPassword("original-pass-1") } })).id;
  userB.id = (await prisma.user.create({ data: { email: userB.email, name: userB.name, phone: "0400 000 000", passwordHash: await hashPassword("original-pass-2") } })).id;
});

afterAll(async () => {
  const userIds = [userA.id, userB.id, hostUserId];
  await prisma.favourite.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.booking.deleteMany({ where: { property: { destinationId } } });
  await prisma.property.deleteMany({ where: { destinationId } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.destination.deleteMany({ where: { id: destinationId } });
  await prisma.$disconnect();
});

beforeEach(() => {
  asUser(null);
  vi.mocked(demoListingsVisible).mockReturnValue(true);
});

describe("search filtering", () => {
  it("restricts results to the destination and excludes unpublished listings", async () => {
    const r = await search({ adults: "1" }, 50);
    expect(r.totalResults).toBe(13); // 12 published + 1 demo
    expect(r.results.map((p) => p.id)).not.toContain(ids.pending);
  });

  it("filters by guest capacity", async () => {
    const r = await search({ guests: "5" }, 50);
    expect(r.totalResults).toBe(6);
    expect(r.results.every((p) => p.maxGuests >= 5)).toBe(true);
  });

  it("filters by price range (nightly AUD)", async () => {
    const r = await search({ adults: "1", minPrice: "150", maxPrice: "180" }, 50);
    expect(r.results.map((p) => p.nightlyPriceCents).sort((a, b) => a - b)).toEqual([15_000, 16_000, 17_000, 18_000]);
  });

  it("requires every selected amenity", async () => {
    const pool = await search({ adults: "1", amenities: "pool" }, 50);
    expect(pool.totalResults).toBe(6);
    const poolAndSpa = await search({ adults: "1", amenities: "pool,spa" }, 50);
    expect(poolAndSpa.results.map((p) => p.title).sort()).toEqual(["Fixture 00", "Fixture 04", "Fixture 08"]);
  });

  it("excludes demo listings when they are hidden", async () => {
    vi.mocked(demoListingsVisible).mockReturnValue(false);
    const r = await search({ adults: "1" }, 50);
    expect(r.totalResults).toBe(12);
    expect(r.results.some((p) => p.isDemo)).toBe(false);
  });

  it("never returns exact coordinates", async () => {
    const r = await search({ adults: "1" }, 50);
    for (const p of r.results) {
      expect(Math.round(p.latitude * 100) / 100).toBe(p.latitude);
      expect(Math.round(p.longitude * 100) / 100).toBe(p.longitude);
    }
    expect(r.mapPoints.every((m) => Math.round(m.latitude * 100) / 100 === m.latitude)).toBe(true);
  });
});

describe("pagination and sorting", () => {
  it("paginates on the server with stable, complete, non-overlapping pages", async () => {
    const q = { adults: "1", sort: "price_asc" };
    const p1 = await search({ ...q, page: "1" }, 5);
    const p2 = await search({ ...q, page: "2" }, 5);
    const p3 = await search({ ...q, page: "3" }, 5);
    expect([p1.totalResults, p1.totalPages]).toEqual([13, 3]);
    expect([p1.results.length, p2.results.length, p3.results.length]).toEqual([5, 5, 3]);
    const all = [...p1.results, ...p2.results, ...p3.results].map((p) => p.id);
    expect(new Set(all).size).toBe(13);
    expect(p2.page).toBe(2);
    // Map points cover every match regardless of page.
    expect(p2.mapPoints).toHaveLength(13);
  });

  it("clamps an out-of-range page to the last page", async () => {
    const r = await search({ adults: "1", page: "40" }, 5);
    expect(r.page).toBe(3);
    expect(r.results).toHaveLength(3);
  });

  it("sorts by price in both directions", async () => {
    const asc = (await search({ adults: "1", sort: "price_asc" }, 50)).results.map((p) => p.nightlyPriceCents);
    const desc = (await search({ adults: "1", sort: "price_desc" }, 50)).results.map((p) => p.nightlyPriceCents);
    expect(asc).toEqual([...asc].sort((a, b) => a - b));
    expect(desc).toEqual([...asc].reverse());
  });

  it("sorts well-reviewed listings first when sorting by rating", async () => {
    const r = await search({ adults: "1", sort: "rating" }, 50);
    expect(r.results.slice(0, 4).every((p) => p.ratingAverage === 4.9)).toBe(true);
  });
});

describe("property detail", () => {
  it("returns public data with only an approximate location", async () => {
    const p = await getPublicProperty(`p2-${run}-3`);
    expect(p?.title).toBe("Fixture 03");
    expect(p).not.toHaveProperty("latitude");
    expect(p).not.toHaveProperty("addressLine1");
    expect(p?.area).toEqual({ latitude: -33.01, longitude: 150.51 });
  });

  it("returns null for unpublished listings and for demo listings when hidden", async () => {
    expect(await getPublicProperty(`p2-${run}-pending`)).toBeNull();
    vi.mocked(demoListingsVisible).mockReturnValue(false);
    expect(await getPublicProperty(`p2-${run}-demo`)).toBeNull();
  });

  it("quotes from server prices and rejects booked dates", async () => {
    const property = (await getPublicProperty(`p2-${run}-6`))!;
    const stay = { checkIn: parseIsoDate("2027-08-02"), checkOut: parseIsoDate("2027-08-04"), nights: 2 };
    const ok = await getStayQuote(property, stay, 2);
    expect(ok.status).toBe("ok");
    if (ok.status === "ok") expect(ok.quote.subtotalCents).toBe(16_000 * 2 + 5_000);

    await prisma.booking.create({
      data: {
        reference: `RV-P2-${run}`, propertyId: property.id, guestId: userB.id, status: "CONFIRMED",
        checkIn: parseIsoDate("2027-08-03"), checkOut: parseIsoDate("2027-08-05"), nights: 2, adults: 2, currency: "AUD",
        accommodationCents: 1, cleaningFeeCents: 0, guestServiceFeeCents: 0, totalCents: 1, hostCommissionCents: 0,
        hostPayoutCents: 1, platformRevenueCents: 0, guestServiceFeeBps: 600, hostCommissionBps: 400,
      },
    });
    expect((await getStayQuote(property, stay, 2)).status).toBe("unavailable");
    expect((await getStayQuote(property, stay, 7)).status).toBe("too_many_guests");
  });
});

describe("favourites", () => {
  it("saves, prevents duplicates and removes", async () => {
    expect(await setFavourite(userA.id, ids.p1!, true)).toBe("saved");
    expect(await setFavourite(userA.id, ids.p1!, true)).toBe("saved"); // idempotent
    expect(await prisma.favourite.count({ where: { userId: userA.id, propertyId: ids.p1 } })).toBe(1);
    // The database itself rejects a duplicate row.
    await expect(prisma.favourite.create({ data: { userId: userA.id, propertyId: ids.p1! } })).rejects.toThrow();

    expect(await setFavourite(userA.id, ids.p1!, false)).toBe("removed");
    expect(await prisma.favourite.count({ where: { userId: userA.id, propertyId: ids.p1 } })).toBe(0);
  });

  it("cannot save a listing that isn't publicly visible", async () => {
    expect(await setFavourite(userA.id, ids.pending!, true)).toBe("not_found");
    vi.mocked(demoListingsVisible).mockReturnValue(false);
    expect(await setFavourite(userA.id, ids.demo!, true)).toBe("not_found");
  });

  it("requires a signed-in user", async () => {
    asUser(null);
    expect(await setFavouriteAction({ propertyId: ids.p2!, saved: true })).toEqual({ ok: false, error: "unauthenticated" });
    expect(await prisma.favourite.count({ where: { propertyId: ids.p2 } })).toBe(0);
  });

  it("always acts as the session user, ignoring any client-supplied userId", async () => {
    asUser(userA);
    const forged = { propertyId: ids.p2!, saved: true, userId: userB.id } as { propertyId: string; saved: boolean };
    expect(await setFavouriteAction(forged)).toEqual({ ok: true, saved: true });
    expect(await prisma.favourite.count({ where: { userId: userA.id, propertyId: ids.p2 } })).toBe(1);
    expect(await prisma.favourite.count({ where: { userId: userB.id } })).toBe(0);
  });
});

describe("account access", () => {
  const form = (fields: Record<string, string>) => {
    const fd = new FormData();
    for (const [k, v] of Object.entries(fields)) fd.set(k, v);
    return fd;
  };

  it("rejects profile updates without a session", async () => {
    asUser(null);
    const res = await updateProfile({}, form({ name: "Hacker", phone: "" }));
    expect(res.error).toBeTruthy();
    expect((await prisma.user.findUniqueOrThrow({ where: { id: userA.id } })).name).toBe(userA.name);
  });

  it("only updates the session user's name and phone", async () => {
    asUser(userA);
    const res = await updateProfile({}, form({ name: "Alex Updated", phone: "0412 345 678", userId: userB.id, email: "evil@example.com", role: "ADMIN" }));
    expect(res.ok).toBe(true);
    const a = await prisma.user.findUniqueOrThrow({ where: { id: userA.id } });
    const b = await prisma.user.findUniqueOrThrow({ where: { id: userB.id } });
    expect([a.name, a.phone, a.email, a.role]).toEqual(["Alex Updated", "0412 345 678", userA.email, "CUSTOMER"]);
    expect([b.name, b.phone]).toEqual([userB.name, "0400 000 000"]);
  });
});

describe("password reset", () => {
  it("stores only a hash of a high-entropy token with an expiry", async () => {
    const before = Date.now();
    const issued = (await issuePasswordReset(userB.email))!;
    expect(issued.token.length).toBeGreaterThanOrEqual(43);
    const row = await prisma.passwordResetToken.findUniqueOrThrow({ where: { tokenHash: hashToken(issued.token) } });
    expect(row.tokenHash).not.toBe(issued.token);
    expect(row.expiresAt.getTime() - before).toBeGreaterThan(29 * 60_000);
    expect(row.expiresAt.getTime() - before).toBeLessThanOrEqual(31 * 60_000);
  });

  it("returns null (no token) for unknown emails", async () => {
    expect(await issuePasswordReset(`nobody-${run}@integration.test`)).toBeNull();
  });

  it("invalidates earlier tokens when a new one is issued", async () => {
    const first = (await issuePasswordReset(userB.email))!;
    const second = (await issuePasswordReset(userB.email))!;
    expect(await inspectResetToken(first.token)).toBe("invalid");
    expect(await inspectResetToken(second.token)).toBe("valid");
  });

  it("rejects expired tokens", async () => {
    const issued = (await issuePasswordReset(userB.email))!;
    const later = new Date(Date.now() + 31 * 60_000);
    expect(await inspectResetToken(issued.token, later)).toBe("expired");
    expect(await consumePasswordReset(issued.token, "brand-new-pass-9", later)).toEqual({ ok: false, reason: "expired" });
  });

  it("resets once, revokes sessions, and refuses reuse", async () => {
    await prisma.session.create({ data: { id: hashToken(`sess-${run}`), userId: userB.id, expiresAt: new Date(Date.now() + 86_400_000) } });
    const issued = (await issuePasswordReset(userB.email))!;

    expect(await consumePasswordReset(issued.token, "brand-new-pass-9")).toEqual({ ok: true, userId: userB.id });
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userB.id } });
    expect(await verifyPassword("brand-new-pass-9", user.passwordHash)).toBe(true);
    expect(await verifyPassword("original-pass-2", user.passwordHash)).toBe(false);
    expect(await prisma.session.count({ where: { userId: userB.id } })).toBe(0);

    expect(await consumePasswordReset(issued.token, "another-pass-99")).toEqual({ ok: false, reason: "used" });
    expect(await inspectResetToken("not-a-real-token")).toBe("invalid");
  });

  it("allows exactly one of several concurrent uses of the same token", async () => {
    const issued = (await issuePasswordReset(userB.email))!;
    const results = await Promise.all([1, 2, 3].map((i) => consumePasswordReset(issued.token, `concurrent-pass-${i}`)));
    expect(results.filter((r) => r.ok)).toHaveLength(1);
  });
});
