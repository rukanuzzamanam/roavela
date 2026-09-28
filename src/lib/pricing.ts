import { eachNight, isWeekendNight, nightsBetween, toIsoDate } from "./dates";
import type { Cents } from "./money";

/**
 * Marketplace fee rates in basis points (1% = 100 bps).
 * Rates come from the active PlatformFeeSchedule — never hard-code them at call sites.
 */
export interface FeeRates {
  guestServiceFeeBps: number;
  hostCommissionBps: number;
}

export interface FeeBreakdown {
  /** Amount the fees are calculated on (accommodation + cleaning). */
  subtotalCents: Cents;
  guestServiceFeeCents: Cents;
  /** What the guest pays. */
  guestTotalCents: Cents;
  hostCommissionCents: Cents;
  /** Host payout before any payment-processing costs. */
  hostPayoutCents: Cents;
  /** Guest fee + host commission. This is GROSS revenue, not profit: processing costs are tracked separately. */
  platformRevenueCents: Cents;
}

export const MAX_FEE_BPS = 5000;

export function assertValidFeeRates(rates: FeeRates): void {
  // Check the rate fields explicitly — callers often pass a richer object (e.g. a fee schedule row).
  const fields = { guestServiceFeeBps: rates.guestServiceFeeBps, hostCommissionBps: rates.hostCommissionBps };
  for (const [name, bps] of Object.entries(fields)) {
    if (!Number.isInteger(bps) || bps < 0 || bps > MAX_FEE_BPS) {
      throw new RangeError(`${name} must be an integer between 0 and ${MAX_FEE_BPS} bps (got ${bps})`);
    }
  }
}

/** Apply a basis-point rate to an integer amount, rounding half-up to the nearest minor unit. */
export function applyBps(amountCents: Cents, bps: number): Cents {
  if (!Number.isInteger(amountCents) || amountCents < 0) {
    throw new RangeError(`amount must be a non-negative integer number of minor units (got ${amountCents})`);
  }
  // Integer arithmetic avoids float drift: (a * bps + 5000) / 10000, floored == round-half-up.
  return Math.floor((amountCents * bps + 5000) / 10000);
}

export function calculateFees(subtotalCents: Cents, rates: FeeRates): FeeBreakdown {
  assertValidFeeRates(rates);
  const guestServiceFeeCents = applyBps(subtotalCents, rates.guestServiceFeeBps);
  const hostCommissionCents = applyBps(subtotalCents, rates.hostCommissionBps);
  return {
    subtotalCents,
    guestServiceFeeCents,
    guestTotalCents: subtotalCents + guestServiceFeeCents,
    hostCommissionCents,
    hostPayoutCents: subtotalCents - hostCommissionCents,
    platformRevenueCents: guestServiceFeeCents + hostCommissionCents,
  };
}

export interface NightlyRateInput {
  nightlyPriceCents: Cents;
  /** Applies to Friday and Saturday nights when set. */
  weekendPriceCents?: Cents | null;
  cleaningFeeCents: Cents;
  /** Per-night price overrides keyed by ISO date (from the Availability table). */
  overrides?: ReadonlyMap<string, Cents>;
}

export interface StayQuote extends FeeBreakdown {
  nights: number;
  nightlyRates: { date: string; cents: Cents }[];
  accommodationCents: Cents;
  cleaningFeeCents: Cents;
}

export function quoteStay(checkIn: Date, checkOut: Date, pricing: NightlyRateInput, rates: FeeRates): StayQuote {
  const nights = nightsBetween(checkIn, checkOut);
  if (nights < 1) throw new RangeError("Check-out must be after check-in");

  const nightlyRates = eachNight(checkIn, checkOut).map((date) => {
    const iso = toIsoDate(date);
    const override = pricing.overrides?.get(iso);
    const cents =
      override ??
      (isWeekendNight(date) && pricing.weekendPriceCents ? pricing.weekendPriceCents : pricing.nightlyPriceCents);
    return { date: iso, cents };
  });

  const accommodationCents = nightlyRates.reduce((sum, n) => sum + n.cents, 0);
  const fees = calculateFees(accommodationCents + pricing.cleaningFeeCents, rates);

  return { nights, nightlyRates, accommodationCents, cleaningFeeCents: pricing.cleaningFeeCents, ...fees };
}
