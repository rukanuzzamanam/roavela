/**
 * Development seed. Creates DEMO data only (every row flagged isDemo) plus reference data
 * (amenities, destinations, drive estimates, default fee schedule).
 *
 * Safe to re-run: existing demo rows are removed and recreated; reference data is upserted.
 * Refuses to run against production unless ALLOW_DEMO_SEED=true.
 */
import "dotenv/config";
import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { AMENITIES } from "../src/config/amenities";
import { PrismaClient } from "../src/generated/prisma/client";
import { addDays, nightsBetween, parseIsoDate } from "../src/lib/dates";
import { quoteStay, type FeeRates } from "../src/lib/pricing";
import { hashPassword } from "../src/server/auth/password";
import { DESTINATIONS, DRIVE_ESTIMATES, EXPERIENCES, GUESTS, HOSTS, PROPERTIES, REVIEW_TEXTS } from "./seed-data";

if (process.env.NODE_ENV === "production" && process.env.ALLOW_DEMO_SEED !== "true") {
  console.error("Refusing to seed demo data in production. Set ALLOW_DEMO_SEED=true to override.");
  process.exit(1);
}
if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set.");
  process.exit(1);
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });

const DEMO_EMAIL_DOMAIN = "demo.roavela.test"; // .test is a reserved TLD — these can never receive mail
const DEFAULT_FEES: FeeRates = { guestServiceFeeBps: 600, hostCommissionBps: 400 };
const TIMEZONE = "Australia/Sydney";

async function main() {
  const password = process.env.SEED_DEMO_PASSWORD || `Demo-${randomBytes(9).toString("base64url")}`;
  const passwordHash = await hashPassword(password);

  // ── Remove previous demo data (children first) ──
  const demoBookings = { isDemo: true };
  await prisma.review.deleteMany({ where: { isDemo: true } });
  await prisma.payment.deleteMany({ where: { booking: demoBookings } });
  await prisma.payout.deleteMany({ where: { host: { isDemo: true } } });
  await prisma.booking.deleteMany({ where: demoBookings });
  await prisma.complianceDocument.deleteMany({ where: { host: { isDemo: true } } });
  await prisma.property.deleteMany({ where: { isDemo: true } });
  await prisma.hostProfile.deleteMany({ where: { isDemo: true } });
  await prisma.adminAction.deleteMany({ where: { admin: { isDemo: true } } });
  await prisma.platformFeeSchedule.updateMany({ where: { createdBy: { isDemo: true } }, data: { createdById: null } });
  await prisma.user.deleteMany({ where: { isDemo: true } });
  await prisma.experience.deleteMany({ where: { isDemo: true } });

  // ── Reference data ──
  for (const [i, a] of AMENITIES.entries()) {
    await prisma.amenity.upsert({
      where: { key: a.key },
      create: { key: a.key, label: a.label, category: a.category, icon: a.icon, sortOrder: i },
      update: { label: a.label, category: a.category, icon: a.icon, sortOrder: i },
    });
  }
  const amenityIds = new Map((await prisma.amenity.findMany({ select: { id: true, key: true } })).map((a) => [a.key, a.id]));

  const destinationIds = new Map<string, string>();
  for (const d of DESTINATIONS) {
    const data = {
      name: d.name,
      kind: d.kind,
      parentId: d.parent ? destinationIds.get(d.parent) : null,
      countryCode: "AU",
      adminArea: d.adminArea ?? null,
      latitude: d.latitude,
      longitude: d.longitude,
      timezone: TIMEZONE,
      isOrigin: d.isOrigin ?? false,
      isPublished: d.isPublished ?? false,
      tagline: d.tagline ?? null,
      summary: d.summary ?? null,
      heroImageUrl: d.heroImageUrl ?? null,
    };
    const row = await prisma.destination.upsert({ where: { slug: d.slug }, create: { slug: d.slug, ...data }, update: data });
    destinationIds.set(d.slug, row.id);
  }

  for (const e of DRIVE_ESTIMATES) {
    const originId = destinationIds.get(e.origin)!;
    const destinationId = destinationIds.get(e.destination)!;
    const data = { durationMinutes: e.minutes, distanceMeters: e.km * 1000, source: "MANUAL_ESTIMATE" as const, provider: null, computedAt: new Date() };
    await prisma.driveEstimate.upsert({
      where: { originId_destinationId: { originId, destinationId } },
      create: { originId, destinationId, ...data },
      update: data,
    });
  }

  const feeSchedule = await prisma.platformFeeSchedule.upsert({
    where: { id: "fee_default_global" },
    create: { id: "fee_default_global", name: "Default marketplace fees", countryCode: null, ...DEFAULT_FEES, effectiveFrom: new Date("2026-01-01T00:00:00Z") },
    update: {},
  });

  // ── Demo users ──
  const admin = await prisma.user.create({
    data: { email: `admin@${DEMO_EMAIL_DOMAIN}`, name: "Demo Admin", role: "ADMIN", passwordHash, isDemo: true, emailVerifiedAt: new Date() },
  });

  const hostProfiles = new Map<string, string>();
  for (const [i, h] of HOSTS.entries()) {
    const user = await prisma.user.create({
      data: {
        email: i === 0 ? `host@${DEMO_EMAIL_DOMAIN}` : `host-${h.key}@${DEMO_EMAIL_DOMAIN}`,
        name: h.name,
        role: "HOST",
        passwordHash,
        isDemo: true,
        emailVerifiedAt: new Date(),
        hostProfile: { create: { displayName: h.displayName, bio: h.bio, onboardingStatus: "COMPLETE", isDemo: true } },
      },
      include: { hostProfile: true },
    });
    hostProfiles.set(h.key, user.hostProfile!.id);
  }

  const guestIds: string[] = [];
  for (const [i, g] of GUESTS.entries()) {
    const user = await prisma.user.create({
      data: {
        email: i === 0 ? `guest@${DEMO_EMAIL_DOMAIN}` : `guest-${g.key}@${DEMO_EMAIL_DOMAIN}`,
        name: g.name,
        role: "CUSTOMER",
        passwordHash,
        isDemo: true,
        emailVerifiedAt: new Date(),
      },
    });
    guestIds.push(user.id);
  }

  // ── Demo properties ──
  let bookingSeq = 0;
  let reviewSeq = 0;
  const propertyIds = new Map<string, string>();
  const now = new Date();

  for (const p of PROPERTIES) {
    const status = p.status ?? "PUBLISHED";
    const property = await prisma.property.create({
      data: {
        slug: p.slug,
        hostId: hostProfiles.get(p.host)!,
        destinationId: destinationIds.get(p.destination)!,
        title: p.title,
        summary: p.summary,
        description: p.description,
        type: p.type,
        status,
        addressLine1: "Demo listing — address withheld",
        locality: p.locality,
        adminArea: "NSW",
        postcode: p.postcode,
        countryCode: "AU",
        latitude: p.latitude,
        longitude: p.longitude,
        timezone: TIMEZONE,
        bedrooms: p.bedrooms,
        beds: p.beds,
        bathrooms: p.bathrooms,
        maxGuests: p.maxGuests,
        currency: "AUD",
        nightlyPriceCents: p.nightly * 100,
        weekendPriceCents: p.weekend ? p.weekend * 100 : null,
        cleaningFeeCents: p.cleaning * 100,
        minNights: p.minNights,
        cancellationPolicy: p.cancellation,
        houseRules: p.houseRules,
        isDemo: true,
        submittedAt: now,
        reviewedAt: status === "PUBLISHED" ? now : null,
        publishedAt: status === "PUBLISHED" ? now : null,
        images: {
          create: p.scenes.map((scene, i) => ({
            url: `/demo/scenes/${scene}.svg`,
            alt: `Illustration for ${p.title} (demo image, ${scene})`,
            position: i,
          })),
        },
        amenities: { create: p.amenities.map((key) => ({ amenityId: amenityIds.get(key)! })) },
      },
    });
    propertyIds.set(p.slug, property.id);

    // Completed past stays with verified demo reviews.
    const ratings = p.reviews ?? [];
    for (const [i, overall] of ratings.entries()) {
      const checkIn = addDays(parseIsoDate("2026-05-01"), (reviewSeq * 9 + i * 17) % 110);
      const checkOut = addDays(checkIn, 2);
      const quote = quoteStay(checkIn, checkOut, { nightlyPriceCents: p.nightly * 100, weekendPriceCents: p.weekend ? p.weekend * 100 : null, cleaningFeeCents: p.cleaning * 100 }, DEFAULT_FEES);
      const guestId = guestIds[(reviewSeq + i) % guestIds.length]!;
      bookingSeq += 1;
      const booking = await prisma.booking.create({
        data: {
          reference: `RV-DEMO-${String(bookingSeq).padStart(3, "0")}`,
          propertyId: property.id,
          guestId,
          status: "COMPLETED",
          checkIn,
          checkOut,
          nights: nightsBetween(checkIn, checkOut),
          adults: 2,
          currency: "AUD",
          accommodationCents: quote.accommodationCents,
          cleaningFeeCents: quote.cleaningFeeCents,
          guestServiceFeeCents: quote.guestServiceFeeCents,
          totalCents: quote.guestTotalCents,
          hostCommissionCents: quote.hostCommissionCents,
          hostPayoutCents: quote.hostPayoutCents,
          platformRevenueCents: quote.platformRevenueCents,
          guestServiceFeeBps: DEFAULT_FEES.guestServiceFeeBps,
          hostCommissionBps: DEFAULT_FEES.hostCommissionBps,
          feeScheduleId: feeSchedule.id,
          confirmedAt: addDays(checkIn, -14),
          completedAt: checkOut,
          isDemo: true,
        },
      });
      const clamp = (n: number) => Math.min(5, Math.max(1, n));
      await prisma.review.create({
        data: {
          bookingId: booking.id,
          propertyId: property.id,
          authorId: guestId,
          overallRating: overall,
          cleanlinessRating: clamp(overall - (i % 3 === 2 ? 1 : 0)),
          locationRating: 5,
          valueRating: clamp(overall - (i % 2)),
          communicationRating: 5,
          body: REVIEW_TEXTS[(reviewSeq + i) % REVIEW_TEXTS.length]!,
          isDemo: true,
          createdAt: addDays(checkOut, 3),
        },
      });
    }
    reviewSeq += 1;

    if (ratings.length > 0) {
      await prisma.property.update({
        where: { id: property.id },
        data: {
          reviewCount: ratings.length,
          ratingAverage: Math.round((ratings.reduce((a, b) => a + b, 0) / ratings.length) * 100) / 100,
        },
      });
    }
  }

  // ── Upcoming demo bookings and blocks (exercise availability filtering) ──
  async function createUpcoming(slug: string, checkInIso: string, checkOutIso: string, status: "CONFIRMED" | "PENDING") {
    const p = PROPERTIES.find((x) => x.slug === slug)!;
    const checkIn = parseIsoDate(checkInIso);
    const checkOut = parseIsoDate(checkOutIso);
    const quote = quoteStay(checkIn, checkOut, { nightlyPriceCents: p.nightly * 100, weekendPriceCents: p.weekend ? p.weekend * 100 : null, cleaningFeeCents: p.cleaning * 100 }, DEFAULT_FEES);
    bookingSeq += 1;
    await prisma.booking.create({
      data: {
        reference: `RV-DEMO-${String(bookingSeq).padStart(3, "0")}`,
        propertyId: propertyIds.get(slug)!,
        guestId: guestIds[0]!,
        status,
        checkIn,
        checkOut,
        nights: quote.nights,
        adults: 2,
        currency: "AUD",
        accommodationCents: quote.accommodationCents,
        cleaningFeeCents: quote.cleaningFeeCents,
        guestServiceFeeCents: quote.guestServiceFeeCents,
        totalCents: quote.guestTotalCents,
        hostCommissionCents: quote.hostCommissionCents,
        hostPayoutCents: quote.hostPayoutCents,
        platformRevenueCents: quote.platformRevenueCents,
        guestServiceFeeBps: DEFAULT_FEES.guestServiceFeeBps,
        hostCommissionBps: DEFAULT_FEES.hostCommissionBps,
        feeScheduleId: feeSchedule.id,
        confirmedAt: status === "CONFIRMED" ? now : null,
        isDemo: true,
      },
    });
  }
  await createUpcoming("pokolbin-vineyard-cottage", "2026-10-16", "2026-10-18", "CONFIRMED");
  await createUpcoming("blowhole-point-apartment", "2026-10-23", "2026-10-25", "PENDING");
  await prisma.blockedDate.create({
    data: {
      propertyId: propertyIds.get("hyams-whitesand-beach-house")!,
      startDate: parseIsoDate("2026-10-09"),
      endDate: parseIsoDate("2026-10-12"),
      reason: "Owner stay (demo)",
    },
  });

  // ── Experiences ──
  for (const e of EXPERIENCES) {
    await prisma.experience.create({
      data: {
        slug: e.slug,
        destinationId: destinationIds.get(e.destination)!,
        title: e.title,
        category: e.category,
        summary: e.summary,
        durationMinutes: e.durationMinutes,
        status: "PUBLISHED",
        isDemo: true,
      },
    });
  }

  const published = PROPERTIES.filter((p) => (p.status ?? "PUBLISHED") === "PUBLISHED").length;
  const reviewCount = await prisma.review.count({ where: { isDemo: true } });
  console.log(
    `\nSeeded ${PROPERTIES.length} demo properties (${published} published, ${PROPERTIES.length - published} pending review), ` +
      `${bookingSeq} demo bookings, ${reviewCount} demo reviews.`,
  );
  console.log("\nDemo accounts (all share one password):");
  console.log(`  ${admin.email}  host@${DEMO_EMAIL_DOMAIN}  guest@${DEMO_EMAIL_DOMAIN}`);
  console.log(
    process.env.SEED_DEMO_PASSWORD
      ? "  Password: the value of SEED_DEMO_PASSWORD"
      : `  Password (randomly generated for this run): ${password}\n  Set SEED_DEMO_PASSWORD to choose your own.`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
