import "server-only";
import { toIsoDate } from "@/lib/dates";
import { quoteStay, type StayQuote } from "@/lib/pricing";
import { prisma } from "@/server/db";
import { getActiveFeeSchedule, type ActiveFeeSchedule } from "./fees";
import { stayAvailabilityConditions, type StayRange } from "./search-query";

export type StayQuoteResult =
  | { status: "ok"; quote: StayQuote; feeSchedule: ActiveFeeSchedule }
  | { status: "too_many_guests"; maxGuests: number }
  | { status: "min_nights"; minNights: number }
  | { status: "max_nights"; maxNights: number }
  | { status: "unavailable" };

interface QuotableProperty {
  id: string;
  countryCode: string;
  nightlyPriceCents: number | null;
  weekendPriceCents: number | null;
  cleaningFeeCents: number;
  minNights: number;
  maxNights: number | null;
  maxGuests: number;
}

/**
 * Price and availability for a specific stay — the single source of truth for the property page
 * and the booking preview. Prices always come from the database and the active fee schedule, never
 * from the client. Availability uses the same rules as search (stayAvailabilityConditions).
 *
 * On its own this holds nothing; createBookingHold() turns an ok quote into a priced PENDING hold.
 */
export async function getStayQuote(property: QuotableProperty, stay: StayRange, guests: number, now = new Date()): Promise<StayQuoteResult> {
  // An unpriced listing (only possible for drafts) can never be quoted.
  const nightlyPriceCents = property.nightlyPriceCents;
  if (nightlyPriceCents === null) return { status: "unavailable" };
  if (guests > property.maxGuests) return { status: "too_many_guests", maxGuests: property.maxGuests };
  if (stay.nights < property.minNights) return { status: "min_nights", minNights: property.minNights };
  if (property.maxNights !== null && stay.nights > property.maxNights) return { status: "max_nights", maxNights: property.maxNights };

  const [available, overrides, fees] = await Promise.all([
    prisma.property.count({ where: { AND: [{ id: property.id }, ...stayAvailabilityConditions(stay, now)] } }),
    prisma.availability.findMany({
      where: { propertyId: property.id, date: { gte: stay.checkIn, lt: stay.checkOut }, priceCents: { not: null } },
      select: { date: true, priceCents: true },
    }),
    getActiveFeeSchedule(property.countryCode),
  ]);
  if (available === 0) return { status: "unavailable" };

  const quote = quoteStay(
    stay.checkIn,
    stay.checkOut,
    { ...property, nightlyPriceCents, overrides: new Map(overrides.map((o) => [toIsoDate(o.date), o.priceCents as number])) },
    fees,
  );
  return { status: "ok", quote, feeSchedule: fees };
}

export function describeQuoteProblem(result: Exclude<StayQuoteResult, { status: "ok" }>): string {
  switch (result.status) {
    case "too_many_guests":
      return `This stay sleeps up to ${result.maxGuests} guests.`;
    case "min_nights":
      return `This stay has a ${result.minNights}-night minimum.`;
    case "max_nights":
      return `This stay allows up to ${result.maxNights} nights.`;
    case "unavailable":
      return "Those dates aren't available. Try different dates.";
  }
}
