import { describe, expect, it } from "vitest";
import { parseIsoDate } from "@/lib/dates";
import { applyBps, assertValidFeeRates, calculateFees, quoteStay } from "@/lib/pricing";

const RATES = { guestServiceFeeBps: 600, hostCommissionBps: 400 }; // 6% guest fee, 4% host commission

describe("calculateFees (marketplace commission)", () => {
  it("matches the documented $800 booking example", () => {
    const fees = calculateFees(80_000, RATES);
    expect(fees).toEqual({
      subtotalCents: 80_000,
      guestServiceFeeCents: 4_800, // $48
      guestTotalCents: 84_800, // guest pays $848
      hostCommissionCents: 3_200, // $32
      hostPayoutCents: 76_800, // host gross payout $768
      platformRevenueCents: 8_000, // platform GROSS revenue $80
    });
  });

  it("keeps the money equation balanced: guest total = host payout + platform revenue", () => {
    for (const subtotal of [1, 99, 12_345, 55_000, 1_234_567]) {
      const f = calculateFees(subtotal, { guestServiceFeeBps: 725, hostCommissionBps: 333 });
      expect(f.guestTotalCents).toBe(f.hostPayoutCents + f.platformRevenueCents);
    }
  });

  it("uses whatever rates are configured (nothing hard-coded)", () => {
    const f = calculateFees(10_000, { guestServiceFeeBps: 1_000, hostCommissionBps: 0 });
    expect(f.guestServiceFeeCents).toBe(1_000);
    expect(f.hostCommissionCents).toBe(0);
    expect(f.hostPayoutCents).toBe(10_000);
  });

  it("accepts a full fee-schedule record (extra fields are ignored)", () => {
    const schedule = { id: "fee_default_global", name: "Default", ...RATES };
    expect(calculateFees(10_000, schedule).guestServiceFeeCents).toBe(600);
  });

  it("rejects invalid fee configuration", () => {
    expect(() => assertValidFeeRates({ guestServiceFeeBps: -1, hostCommissionBps: 400 })).toThrow(RangeError);
    expect(() => assertValidFeeRates({ guestServiceFeeBps: 600, hostCommissionBps: 5_001 })).toThrow(RangeError);
    expect(() => assertValidFeeRates({ guestServiceFeeBps: 6.5, hostCommissionBps: 400 })).toThrow(RangeError);
  });
});

describe("applyBps", () => {
  it("rounds half up to the nearest cent", () => {
    expect(applyBps(125, 400)).toBe(5); // 5.0
    expect(applyBps(1_238, 400)).toBe(50); // 49.52 → 50
    expect(applyBps(1_237, 400)).toBe(49); // 49.48 → 49
    expect(applyBps(12_345, 600)).toBe(741); // 740.7 → 741
  });

  it("rejects non-integer or negative amounts", () => {
    expect(() => applyBps(10.5, 600)).toThrow(RangeError);
    expect(() => applyBps(-100, 600)).toThrow(RangeError);
  });
});

describe("quoteStay", () => {
  const pricing = { nightlyPriceCents: 23_500, weekendPriceCents: 28_500, cleaningFeeCents: 8_000 };

  it("prices weeknights at the nightly rate", () => {
    // Mon 19 Oct → Wed 21 Oct 2026: two weeknights
    const q = quoteStay(parseIsoDate("2026-10-19"), parseIsoDate("2026-10-21"), pricing, RATES);
    expect(q.nights).toBe(2);
    expect(q.accommodationCents).toBe(47_000);
    expect(q.subtotalCents).toBe(55_000);
    expect(q.guestServiceFeeCents).toBe(3_300);
    expect(q.guestTotalCents).toBe(58_300);
  });

  it("applies weekend pricing to Friday and Saturday nights only", () => {
    // Thu 15 Oct → Sun 18 Oct: Thu (weeknight), Fri + Sat (weekend)
    const q = quoteStay(parseIsoDate("2026-10-15"), parseIsoDate("2026-10-18"), pricing, RATES);
    expect(q.nightlyRates.map((n) => n.cents)).toEqual([23_500, 28_500, 28_500]);
    expect(q.accommodationCents).toBe(80_500);
  });

  it("falls back to the nightly rate when no weekend price is set", () => {
    const q = quoteStay(parseIsoDate("2026-10-16"), parseIsoDate("2026-10-18"), { ...pricing, weekendPriceCents: null }, RATES);
    expect(q.accommodationCents).toBe(47_000);
  });

  it("honours per-night price overrides", () => {
    const overrides = new Map([["2026-10-20", 30_000]]);
    const q = quoteStay(parseIsoDate("2026-10-19"), parseIsoDate("2026-10-21"), { ...pricing, overrides }, RATES);
    expect(q.nightlyRates).toEqual([
      { date: "2026-10-19", cents: 23_500 },
      { date: "2026-10-20", cents: 30_000 },
    ]);
  });

  it("rejects zero or negative-length stays", () => {
    expect(() => quoteStay(parseIsoDate("2026-10-19"), parseIsoDate("2026-10-19"), pricing, RATES)).toThrow();
    expect(() => quoteStay(parseIsoDate("2026-10-20"), parseIsoDate("2026-10-19"), pricing, RATES)).toThrow();
  });
});
