import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { MAX_GUESTS } from "@/config/search";
import { CHECKOUT_HOLD_MINUTES } from "@/lib/booking-lifecycle";
import { addDays, nightsBetween, parseIsoDate, todayInTimeZone } from "@/lib/dates";
import { PRICING_RULES_VERSION } from "@/lib/pricing";
import { bookingRequestSchema, firstName, isPlausibleReference, MAX_BOOKING_HORIZON_DAYS, SUPPORTED_CURRENCIES } from "@/lib/validation/booking";
import { MAX_STAY_NIGHTS } from "@/lib/validation/search";
import { generateBookingReference } from "@/server/booking-reference";
import { prisma } from "@/server/db";
import { isBookingOverlapError, isUniqueViolation } from "@/server/db-errors";
import { demoListingsVisible } from "@/server/env";
import { log } from "@/server/log";
import { track } from "@/server/providers/analytics";
import { describeQuoteProblem, getStayQuote } from "./stay-quote";
import { publicVisibilityConditions } from "./search-query";

/**
 * Booking creation. The browser sends only WHAT the guest wants (property, dates, party size).
 * Everything with money or status in it is decided here: the price comes from the database and
 * the active fee schedule, the dates are held by the database exclusion constraint, and only a
 * verified payment event (see payments/events.ts) ever confirms a booking.
 */

export type CreateHoldResult =
  | { ok: true; reference: string; reused: boolean }
  | { ok: false; code: "invalid" | "not_found" | "own_listing" | "dates" | "unavailable" | "currency"; error: string };

interface Guest {
  id: string;
}

const holdPropertySelect = {
  id: true,
  title: true,
  isDemo: true,
  countryCode: true,
  timezone: true,
  currency: true,
  nightlyPriceCents: true,
  weekendPriceCents: true,
  cleaningFeeCents: true,
  minNights: true,
  maxNights: true,
  maxGuests: true,
  cancellationPolicy: true,
  checkInTime: true,
  checkOutTime: true,
  smokingAllowed: true,
  petsAllowed: true,
  eventsAllowed: true,
  quietHoursStart: true,
  quietHoursEnd: true,
  houseRules: true,
  host: { select: { userId: true } },
} satisfies Prisma.PropertySelect;

/**
 * Validate a request, price it on the server and hold the dates for CHECKOUT_HOLD_MINUTES as a
 * PENDING booking carrying an immutable pricing snapshot. Safe to call repeatedly: the same guest
 * asking for the same stay gets their existing live hold back instead of a second one.
 */
export async function createBookingHold(guest: Guest, raw: unknown, now = new Date()): Promise<CreateHoldResult> {
  const parsed = bookingRequestSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, code: "invalid", error: "Please check your dates and guests." };
  const req = parsed.data;
  const guests = req.adults + req.children;
  if (guests > MAX_GUESTS) return { ok: false, code: "invalid", error: `Bookings are limited to ${MAX_GUESTS} guests.` };

  const checkIn = parseIsoDate(req.checkIn);
  const checkOut = parseIsoDate(req.checkOut);
  const nights = nightsBetween(checkIn, checkOut);
  if (nights < 1) return { ok: false, code: "dates", error: "Check-out must be after check-in." };
  if (nights > MAX_STAY_NIGHTS) return { ok: false, code: "dates", error: `Stays are limited to ${MAX_STAY_NIGHTS} nights.` };

  const property = await prisma.property.findFirst({
    where: { AND: [{ id: req.propertyId }, ...publicVisibilityConditions(demoListingsVisible())] },
    select: holdPropertySelect,
  });
  if (!property) return { ok: false, code: "not_found", error: "This stay isn't available to book." };
  if (property.host.userId === guest.id) return { ok: false, code: "own_listing", error: "You can't book your own listing." };
  if (!(SUPPORTED_CURRENCIES as readonly string[]).includes(property.currency)) {
    return { ok: false, code: "currency", error: "This stay can't be booked online yet." };
  }

  // "Today" is the property's local calendar date, so a late-evening booking in Perth isn't
  // judged by Sydney's (or the server's) clock.
  const today = todayInTimeZone(property.timezone, now);
  if (checkIn < today) return { ok: false, code: "dates", error: "Check-in can't be in the past." };
  if (checkIn > addDays(today, MAX_BOOKING_HORIZON_DAYS)) return { ok: false, code: "dates", error: "That's too far ahead to book." };

  // Idempotency: a double-click, refresh or retry returns the guest's existing live hold.
  const existing = await prisma.booking.findFirst({
    where: { guestId: guest.id, propertyId: property.id, checkIn, checkOut, status: "PENDING", expiresAt: { gt: now } },
    select: { id: true, reference: true, adults: true, children: true },
  });
  if (existing) {
    if (existing.adults === req.adults && existing.children === req.children) return { ok: true, reference: existing.reference, reused: true };
    // Same stay, different party: release the old hold (it's the guest's own) and re-price.
    await prisma.booking.updateMany({ where: { id: existing.id, status: "PENDING" }, data: { status: "EXPIRED" } });
  }

  const stay = { checkIn, checkOut, nights };
  const quoted = await getStayQuote(property, stay, guests, now);
  if (quoted.status !== "ok") return { ok: false, code: quoted.status === "unavailable" ? "unavailable" : "invalid", error: describeQuoteProblem(quoted) };
  const { quote, feeSchedule } = quoted;

  const expiresAt = new Date(now.getTime() + CHECKOUT_HOLD_MINUTES * 60_000);
  const data = {
    propertyId: property.id,
    guestId: guest.id,
    status: "PENDING" as const,
    checkIn,
    checkOut,
    nights: quote.nights,
    adults: req.adults,
    children: req.children,
    currency: property.currency,
    accommodationCents: quote.accommodationCents,
    cleaningFeeCents: quote.cleaningFeeCents,
    guestServiceFeeCents: quote.guestServiceFeeCents,
    totalCents: quote.guestTotalCents,
    hostCommissionCents: quote.hostCommissionCents,
    hostPayoutCents: quote.hostPayoutCents,
    platformRevenueCents: quote.platformRevenueCents,
    guestServiceFeeBps: feeSchedule.guestServiceFeeBps,
    hostCommissionBps: feeSchedule.hostCommissionBps,
    feeScheduleId: feeSchedule.id,
    pricingSnapshot: {
      rulesVersion: PRICING_RULES_VERSION,
      quotedAt: now.toISOString(),
      feeSchedule: { id: feeSchedule.id, name: feeSchedule.name, guestServiceFeeBps: feeSchedule.guestServiceFeeBps, hostCommissionBps: feeSchedule.hostCommissionBps },
      nightlyRates: quote.nightlyRates,
      accommodationCents: quote.accommodationCents,
      cleaningFeeCents: quote.cleaningFeeCents,
      feeBaseCents: quote.feeBaseCents,
      subtotalCents: quote.subtotalCents,
    },
    cancellationPolicy: property.cancellationPolicy,
    houseRulesSnapshot: {
      checkInTime: property.checkInTime,
      checkOutTime: property.checkOutTime,
      smokingAllowed: property.smokingAllowed,
      petsAllowed: property.petsAllowed,
      eventsAllowed: property.eventsAllowed,
      quietHoursStart: property.quietHoursStart,
      quietHoursEnd: property.quietHoursEnd,
      houseRules: property.houseRules,
    },
    expiresAt,
    // Bookings on demo listings are demo data too (removed with them on re-seed).
    isDemo: property.isDemo,
  } satisfies Omit<Prisma.BookingUncheckedCreateInput, "reference">;

  for (let attempt = 0; attempt < 5; attempt++) {
    const reference = generateBookingReference();
    try {
      const booking = await prisma.$transaction(async (tx) => {
        // Lapsed holds still occupy the exclusion constraint until marked EXPIRED. Release any that
        // overlap — never live ones: those make this insert fail, exactly as they should.
        await tx.booking.updateMany({
          where: { propertyId: property.id, status: "PENDING", expiresAt: { lte: now }, checkIn: { lt: checkOut }, checkOut: { gt: checkIn } },
          data: { status: "EXPIRED" },
        });
        return tx.booking.create({ data: { ...data, reference }, select: { id: true, reference: true } });
      });
      log.info("booking.hold_created", { reference: booking.reference, propertyId: property.id, nights, totalCents: data.totalCents, currency: data.currency });
      track({
        name: "booking_quote_created",
        properties: { propertyId: property.id, bookingId: booking.id, nights, guests, totalCents: data.totalCents, currency: data.currency },
        userId: guest.id,
      });
      return { ok: true, reference: booking.reference, reused: false };
    } catch (e) {
      if (isBookingOverlapError(e)) {
        // A concurrent double-submit by the same guest lost the race to their own request.
        const own = await prisma.booking.findFirst({
          where: { guestId: guest.id, propertyId: property.id, checkIn, checkOut, adults: req.adults, children: req.children, status: "PENDING", expiresAt: { gt: now } },
          select: { reference: true },
        });
        if (own) return { ok: true, reference: own.reference, reused: true };
        log.info("booking.hold_conflict", { propertyId: property.id });
        return { ok: false, code: "unavailable", error: "Sorry — someone else has just reserved those dates. Try different dates." };
      }
      if (isUniqueViolation(e)) continue; // reference collision: astronomically rare, just draw again
      throw e;
    }
  }
  throw new Error("Could not allocate a unique booking reference");
}

// ── Reads (ownership is part of every query) ──────────────────────────────────

const bookingPropertySelect = {
  id: true,
  slug: true,
  title: true,
  type: true,
  isDemo: true,
  timezone: true,
  locality: true,
  adminArea: true,
  destination: { select: { name: true } },
  images: { orderBy: { position: "asc" }, take: 1, select: { url: true, alt: true } },
} satisfies Prisma.PropertySelect;

/** A guest's own booking. Another user's reference returns null (rendered as 404 — no oracle). */
export async function getGuestBooking(guestId: string, reference: string) {
  if (!isPlausibleReference(reference)) return null;
  return prisma.booking.findFirst({
    where: { reference, guestId },
    include: {
      property: { select: { ...bookingPropertySelect, addressLine1: true, addressLine2: true, postcode: true, host: { select: { displayName: true } } } },
      payments: { select: { id: true, provider: true, status: true, amountCents: true, refundedCents: true, currency: true, failureCode: true, updatedAt: true } },
    },
  });
}
export type GuestBooking = NonNullable<Awaited<ReturnType<typeof getGuestBooking>>>;

export async function listGuestBookings(guestId: string) {
  return prisma.booking.findMany({
    where: { guestId },
    orderBy: [{ checkIn: "asc" }],
    take: 200,
    select: {
      id: true,
      reference: true,
      status: true,
      checkIn: true,
      checkOut: true,
      nights: true,
      adults: true,
      children: true,
      totalCents: true,
      currency: true,
      expiresAt: true,
      isDemo: true,
      property: { select: bookingPropertySelect },
    },
  });
}

/** Statuses hosts see: real bookings only — unpaid checkout holds are not bookings yet. */
export const HOST_VISIBLE_STATUSES = ["CONFIRMED", "COMPLETED", "CANCELLED", "REFUND_PENDING", "REFUNDED"] as const;

const hostBookingSelect = {
  id: true,
  reference: true,
  status: true,
  checkIn: true,
  checkOut: true,
  nights: true,
  adults: true,
  children: true,
  currency: true,
  accommodationCents: true,
  cleaningFeeCents: true,
  hostCommissionCents: true,
  hostCommissionBps: true,
  hostPayoutCents: true,
  cancellationPolicy: true,
  confirmedAt: true,
  cancelledAt: true,
  isDemo: true,
  property: { select: { id: true, title: true, slug: true } },
  guest: { select: { name: true } },
} satisfies Prisma.BookingSelect;

function toHostView<T extends { guest: { name: string } }>(b: T) {
  const { guest, ...rest } = b;
  return { ...rest, guestFirstName: firstName(guest.name) };
}

export async function listHostBookings(hostUserId: string) {
  const rows = await prisma.booking.findMany({
    where: { property: { host: { userId: hostUserId } }, status: { in: [...HOST_VISIBLE_STATUSES] } },
    orderBy: [{ checkIn: "asc" }],
    take: 300,
    select: hostBookingSelect,
  });
  return rows.map(toHostView);
}

/** A booking on one of the host's own listings, or null (another host's booking → 404). */
export async function getHostBooking(hostUserId: string, reference: string) {
  if (!isPlausibleReference(reference)) return null;
  const row = await prisma.booking.findFirst({
    where: { reference, property: { host: { userId: hostUserId } }, status: { in: [...HOST_VISIBLE_STATUSES] } },
    select: hostBookingSelect,
  });
  return row ? toHostView(row) : null;
}
