/**
 * Integration tests against a real PostgreSQL database (DATABASE_URL). They create their own
 * isolated fixtures and remove them afterwards; seeded demo data is not relied upon.
 * Run with: npm run test:integration
 */
import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseIsoDate } from "@/lib/dates";
import { parseSearchParams } from "@/lib/validation/search";
import { prisma } from "@/server/db";
import { searchProperties } from "@/server/services/search";

const run = randomBytes(4).toString("hex");
let hostUserId = "";
let guestId = "";
let propertyId = "";
let pendingPropertyId = "";
let destinationId = "";

function bookingData(checkIn: string, checkOut: string, status: "PENDING" | "CONFIRMED" | "CANCELLED" = "CONFIRMED") {
  return {
    reference: `RV-TEST-${run}-${randomBytes(3).toString("hex")}`,
    propertyId,
    guestId,
    status,
    checkIn: parseIsoDate(checkIn),
    checkOut: parseIsoDate(checkOut),
    nights: 2,
    adults: 2,
    currency: "AUD",
    accommodationCents: 40_000,
    cleaningFeeCents: 5_000,
    guestServiceFeeCents: 2_700,
    totalCents: 47_700,
    hostCommissionCents: 1_800,
    hostPayoutCents: 43_200,
    platformRevenueCents: 4_500,
    guestServiceFeeBps: 600,
    hostCommissionBps: 400,
    // Phase 4: PENDING bookings must carry a live checkout hold (Booking_pending_expiry_check).
    // Without this, PENDING inserts failed on that check rather than on the overlap constraint.
    expiresAt: new Date(Date.now() + 20 * 60_000),
  };
}

beforeAll(async () => {
  const destination = await prisma.destination.create({
    data: { slug: `test-dest-${run}`, name: "Test Destination", kind: "TOWN", countryCode: "AU", latitude: -34, longitude: 150.8, timezone: "Australia/Sydney" },
  });
  destinationId = destination.id;
  const host = await prisma.user.create({
    data: {
      email: `host-${run}@integration.test`,
      name: "Integration Host",
      role: "HOST",
      hostProfile: { create: { displayName: "Integration Host" } },
    },
    include: { hostProfile: true },
  });
  hostUserId = host.id;
  const guest = await prisma.user.create({ data: { email: `guest-${run}@integration.test`, name: "Integration Guest" } });
  guestId = guest.id;

  const base = {
    hostId: host.hostProfile!.id,
    destinationId,
    summary: "Integration test fixture",
    description: "Integration test fixture",
    type: "CABIN" as const,
    addressLine1: "Test",
    locality: "Test",
    countryCode: "AU",
    latitude: -34,
    longitude: 150.8,
    timezone: "Australia/Sydney",
    bedrooms: 1,
    beds: 1,
    bathrooms: 1,
    maxGuests: 2,
    nightlyPriceCents: 20_000,
  };
  propertyId = (await prisma.property.create({ data: { ...base, slug: `test-live-${run}`, title: "Live fixture", status: "PUBLISHED" } })).id;
  pendingPropertyId = (await prisma.property.create({ data: { ...base, slug: `test-pending-${run}`, title: "Pending fixture", status: "PENDING_REVIEW" } })).id;
});

afterAll(async () => {
  await prisma.booking.deleteMany({ where: { propertyId: { in: [propertyId, pendingPropertyId] } } });
  await prisma.property.deleteMany({ where: { id: { in: [propertyId, pendingPropertyId] } } });
  await prisma.user.deleteMany({ where: { id: { in: [hostUserId, guestId] } } });
  await prisma.destination.deleteMany({ where: { id: destinationId } });
  await prisma.$disconnect();
});

describe("double-booking prevention (database exclusion constraint)", () => {
  it("rejects an overlapping CONFIRMED/PENDING booking for the same property", async () => {
    await prisma.booking.create({ data: bookingData("2027-03-05", "2027-03-07", "CONFIRMED") });
    await expect(prisma.booking.create({ data: bookingData("2027-03-06", "2027-03-08", "PENDING") })).rejects.toThrow();
    await expect(prisma.booking.create({ data: bookingData("2027-03-01", "2027-03-10", "CONFIRMED") })).rejects.toThrow();
  });

  it("allows back-to-back bookings (check-out day = next check-in day)", async () => {
    await expect(prisma.booking.create({ data: bookingData("2027-03-07", "2027-03-09") })).resolves.toBeTruthy();
  });

  it("allows overlap with CANCELLED bookings", async () => {
    await prisma.booking.create({ data: bookingData("2027-04-01", "2027-04-03", "CANCELLED") });
    await expect(prisma.booking.create({ data: bookingData("2027-04-02", "2027-04-04") })).resolves.toBeTruthy();
  });

  it("holds under concurrent attempts: exactly one of several simultaneous bookings wins", async () => {
    const attempts = await Promise.allSettled(
      Array.from({ length: 5 }, () => prisma.booking.create({ data: bookingData("2027-05-10", "2027-05-12", "PENDING") })),
    );
    expect(attempts.filter((a) => a.status === "fulfilled")).toHaveLength(1);
  });

  it("rejects bookings whose check-out is not after check-in", async () => {
    await expect(prisma.booking.create({ data: bookingData("2027-06-10", "2027-06-10") })).rejects.toThrow();
  });
});

describe("search availability", () => {
  const search = (q: Record<string, string>) =>
    searchProperties(parseSearchParams(q), { propertyIds: [propertyId, pendingPropertyId] }).then((r) => r.results.map((p) => p.id));

  it("never returns listings that are not PUBLISHED", async () => {
    const ids = await search({ adults: "1" });
    expect(ids).toContain(propertyId);
    expect(ids).not.toContain(pendingPropertyId);
  });

  it("excludes a property whose dates overlap an active booking", async () => {
    expect(await search({ checkIn: "2027-03-06", checkOut: "2027-03-07" })).not.toContain(propertyId);
  });

  it("includes it for dates that only touch an existing booking", async () => {
    expect(await search({ checkIn: "2027-03-12", checkOut: "2027-03-14" })).toContain(propertyId);
  });

  it("excludes a property on host-blocked dates", async () => {
    await prisma.blockedDate.create({ data: { propertyId, startDate: parseIsoDate("2027-07-01"), endDate: parseIsoDate("2027-07-05") } });
    expect(await search({ checkIn: "2027-07-04", checkOut: "2027-07-06" })).not.toContain(propertyId);
    expect(await search({ checkIn: "2027-07-05", checkOut: "2027-07-07" })).toContain(propertyId);
  });

  it("excludes a property that can't fit the party", async () => {
    expect(await search({ adults: "2", children: "1" })).not.toContain(propertyId);
  });
});
