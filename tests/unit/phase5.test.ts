/**
 * Phase 5 unit tests: admin authorisation rules, listing/compliance/review transitions, refund
 * limits, financial reconciliation invariants, commission validation, reporting ranges and the
 * append-only audit guarantee. Pure functions only — no database.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { Role } from "@/generated/prisma/enums";
import { commissionScheduleSchema, COMMISSION_BOUNDS, formatBps, parsePercentToBps, resolveEffectiveFrom, scheduleStates } from "@/lib/admin/commission";
import { complianceTransition, documentFlags, listingComplianceFlags, requiredTypes } from "@/lib/admin/compliance";
import { listHref, oneOf, parsePage, parseQuery } from "@/lib/admin/query";
import { resolveRange, startOfDayIn } from "@/lib/admin/ranges";
import { reconcileBooking, type ReconcileBooking } from "@/lib/admin/reconciliation";
import { checkRefundAmount, committedRefundCents, maxRefundableCents, outstandingPolicyRefundCents } from "@/lib/admin/refunds";
import { parseIsoDate } from "@/lib/dates";
import { transition } from "@/lib/listing-lifecycle";
import { can, PERMISSIONS, type Permission } from "@/lib/permissions";
import { PRICING_RULES_VERSION, splitStayAmounts } from "@/lib/pricing";
import { parseMoneyToCents } from "@/lib/validation/host";
import { moderationTransition } from "@/lib/admin/moderation";

const ADMIN_PERMISSIONS = (Object.keys(PERMISSIONS) as Permission[]).filter((p) => p.startsWith("admin:"));

describe("admin authorisation is capability-based and ADMIN-only", () => {
  it("every admin capability belongs to ADMIN and to no other role", () => {
    expect(ADMIN_PERMISSIONS.length).toBeGreaterThanOrEqual(10);
    for (const p of ADMIN_PERMISSIONS) {
      expect(can("ADMIN", p)).toBe(true);
      expect(can("CUSTOMER", p)).toBe(false);
      expect(can("HOST", p)).toBe(false);
      expect(can(null, p)).toBe(false);
      expect(can(undefined, p)).toBe(false);
    }
  });

  it("only the three known roles exist — a client-sent role string is not a Role", () => {
    expect(Object.values(Role)).toEqual(["CUSTOMER", "HOST", "ADMIN"]);
    // `can` only ever receives the role re-read from the database; arbitrary strings grant nothing.
    expect(can("SUPER_ADMIN" as Role, "admin:portal")).toBe(false);
    expect(can("admin" as Role, "admin:portal")).toBe(false);
  });
});

describe("listing status transitions (no duplicate statuses, no shortcuts to PUBLISHED)", () => {
  it("hosts can never approve, publish or reinstate", () => {
    for (const intent of ["approve", "request_changes", "reject", "suspend", "reinstate"] as const) {
      expect(transition(intent, "host", "PENDING_REVIEW")).toEqual({ ok: false, reason: "wrong_actor" });
    }
    // The only host path to PUBLISHED is resuming a listing an admin already approved and the host paused.
    expect(transition("resume", "host", "PAUSED")).toEqual({ ok: true, to: "PUBLISHED" });
    for (const from of ["DRAFT", "PENDING_REVIEW", "CHANGES_REQUESTED", "REJECTED", "SUSPENDED", "ARCHIVED"] as const) {
      expect(transition("resume", "host", from).ok).toBe(false);
    }
  });

  it("admin approval publishes only from PENDING_REVIEW", () => {
    expect(transition("approve", "admin", "PENDING_REVIEW")).toEqual({ ok: true, to: "PUBLISHED" });
    for (const from of ["DRAFT", "CHANGES_REQUESTED", "REJECTED", "SUSPENDED", "ARCHIVED", "PAUSED", "PUBLISHED"] as const) {
      expect(transition("approve", "admin", from)).toEqual({ ok: false, reason: "invalid_from_status" });
    }
  });

  it("suspension and reinstatement are admin-only, and reinstating never goes straight to live", () => {
    expect(transition("suspend", "admin", "PUBLISHED")).toEqual({ ok: true, to: "SUSPENDED" });
    expect(transition("suspend", "admin", "DRAFT").ok).toBe(false);
    expect(transition("reinstate", "admin", "SUSPENDED")).toEqual({ ok: true, to: "PAUSED" });
    expect(transition("reject", "admin", "PUBLISHED").ok).toBe(false);
  });
});

describe("compliance review", () => {
  const today = parseIsoDate("2027-03-01");
  const base = { status: "SUBMITTED" as const, jurisdiction: "AU-NSW", referenceNumber: "PID-STRA-1", expiresAt: null, data: { confirmed: true } };

  it("transitions: start → review; reviewed/rejected only from submitted or under review", () => {
    expect(complianceTransition("start", "SUBMITTED")).toBe("UNDER_REVIEW");
    expect(complianceTransition("start", "APPROVED")).toBeNull();
    expect(complianceTransition("approve", "UNDER_REVIEW")).toBe("APPROVED");
    expect(complianceTransition("reject", "SUBMITTED")).toBe("REJECTED");
    expect(complianceTransition("approve", "REJECTED")).toBeNull();
    expect(complianceTransition("expire", "APPROVED")).toBe("EXPIRED");
    expect(complianceTransition("expire", "EXPIRED")).toBeNull();
  });

  it("flags expired and expiring-soon records only when the host recorded an expiry date", () => {
    const stra = { ...base, type: "SHORT_TERM_RENTAL_REGISTRATION" as const };
    expect(documentFlags({ ...stra, expiresAt: parseIsoDate("2027-02-28") }, today).map((f) => f.code)).toEqual(["expired"]);
    expect(documentFlags({ ...stra, expiresAt: parseIsoDate("2027-03-20") }, today).map((f) => f.code)).toEqual(["expiring_soon"]);
    expect(documentFlags({ ...stra, expiresAt: parseIsoDate("2027-06-01") }, today)).toEqual([]);
    expect(documentFlags({ ...stra, expiresAt: null }, today)).toEqual([]);
  });

  it("is jurisdiction-aware: NSW requires a registration (or exemption); other states don't", () => {
    const stra = { ...base, type: "SHORT_TERM_RENTAL_REGISTRATION" as const, referenceNumber: null, data: {} };
    expect(documentFlags(stra, today).map((f) => f.code)).toEqual(["registration_missing"]);
    expect(documentFlags({ ...stra, data: { exemptionDeclared: true } }, today)).toEqual([]);
    expect(documentFlags({ ...stra, jurisdiction: "AU-VIC" }, today)).toEqual([]);
    expect(requiredTypes("AU-NSW")).toContain("SHORT_TERM_RENTAL_REGISTRATION");
    expect(requiredTypes("AU-VIC")).not.toContain("SHORT_TERM_RENTAL_REGISTRATION");
    expect(listingComplianceFlags("AU-VIC", [], today).map((f) => f.code)).toEqual(["requirement_missing", "requirement_missing", "requirement_missing"]);
  });

  it("flags unconfirmed insurance / authority", () => {
    expect(documentFlags({ ...base, type: "INSURANCE", data: { confirmed: false } }, today).map((f) => f.code)).toEqual(["not_confirmed"]);
  });
});

describe("review moderation never edits content", () => {
  it("keeps, hides, removes and restores through explicit transitions", () => {
    expect(moderationTransition("keep", "FLAGGED")).toBe("PUBLISHED");
    expect(moderationTransition("hide", "PUBLISHED")).toBe("HIDDEN");
    expect(moderationTransition("remove", "HIDDEN")).toBe("REMOVED");
    expect(moderationTransition("restore", "HIDDEN")).toBe("PUBLISHED");
    expect(moderationTransition("restore", "REMOVED")).toBeNull();
    expect(moderationTransition("keep", "PUBLISHED")).toBeNull();
  });
});

describe("refund limits (integer cents)", () => {
  const paid = { status: "SUCCEEDED" as const, amountCents: 61_000, refundedCents: 0 };

  it("max refundable = paid − confirmed refunds − refunds in flight", () => {
    expect(maxRefundableCents(paid, [])).toBe(61_000);
    expect(maxRefundableCents({ ...paid, refundedCents: 10_000 }, [{ status: "SUCCEEDED", amountCents: 10_000 }])).toBe(51_000);
    expect(maxRefundableCents(paid, [{ status: "PENDING", amountCents: 20_000 }])).toBe(41_000);
    // Failed or cancelled refunds don't count.
    expect(maxRefundableCents(paid, [{ status: "FAILED", amountCents: 61_000 }, { status: "CANCELLED", amountCents: 5 }])).toBe(61_000);
  });

  it("is conservative: an in-flight refund the provider already counted can only reduce the limit", () => {
    expect(committedRefundCents({ ...paid, refundedCents: 20_000 }, [{ status: "PENDING", amountCents: 20_000 }])).toBe(40_000);
  });

  it("never goes negative and is zero for unpaid or fully refunded payments", () => {
    expect(maxRefundableCents({ ...paid, refundedCents: 61_000, status: "REFUNDED" }, [])).toBe(0);
    expect(maxRefundableCents({ ...paid, status: "REQUIRES_PAYMENT" }, [])).toBe(0);
    expect(maxRefundableCents({ ...paid, status: "FAILED" }, [])).toBe(0);
    expect(maxRefundableCents(paid, [{ status: "SUCCEEDED", amountCents: 70_000 }])).toBe(0);
  });

  it("rejects zero, negative, fractional and over-limit amounts", () => {
    expect(checkRefundAmount(1, 100)).toEqual({ ok: true });
    expect(checkRefundAmount(100, 100)).toEqual({ ok: true });
    expect(checkRefundAmount(101, 100).ok).toBe(false);
    expect(checkRefundAmount(0, 100).ok).toBe(false);
    expect(checkRefundAmount(-5, 100).ok).toBe(false);
    expect(checkRefundAmount(10.5, 100).ok).toBe(false);
    expect(checkRefundAmount(Number.NaN, 100).ok).toBe(false);
    expect(checkRefundAmount(5, 0).ok).toBe(false);
  });

  it("policy refund still owed accounts for refunds already made", () => {
    expect(outstandingPolicyRefundCents(30_000, paid, [])).toBe(30_000);
    expect(outstandingPolicyRefundCents(30_000, paid, [{ status: "PENDING", amountCents: 30_000 }])).toBe(0);
    expect(outstandingPolicyRefundCents(30_000, paid, [{ status: "FAILED", amountCents: 30_000 }])).toBe(30_000);
    expect(outstandingPolicyRefundCents(null, paid, [])).toBe(0);
  });

  it("parses admin-entered dollar amounts into integer cents without float drift", () => {
    expect(parseMoneyToCents("0.29")).toBe(29);
    expect(parseMoneyToCents("1234.56")).toBe(123_456);
    expect(parseMoneyToCents("$1,050.10")).toBe(105_010);
    expect(parseMoneyToCents("10")).toBe(1000);
    for (const bad of ["1.005", "-5", "1e3", "abc", "", "0x10", "12.3.4"]) expect(parseMoneyToCents(bad)).toBeNull();
  });
});

describe("financial reconciliation invariants", () => {
  const rates = { guestServiceFeeBps: 1200, hostCommissionBps: 300 };
  const split = splitStayAmounts(50_000, 8_000, rates);
  const booking: ReconcileBooking = Object.freeze({
    status: "CONFIRMED",
    isDemo: false,
    currency: "AUD",
    accommodationCents: 50_000,
    cleaningFeeCents: 8_000,
    guestServiceFeeCents: split.guestServiceFeeCents,
    totalCents: split.guestTotalCents,
    hostCommissionCents: split.hostCommissionCents,
    hostPayoutCents: split.hostPayoutCents,
    platformRevenueCents: split.platformRevenueCents,
    guestServiceFeeBps: 1200,
    hostCommissionBps: 300,
    refundDueCents: null,
    pricingSnapshot: { rulesVersion: PRICING_RULES_VERSION, feeSchedule: { guestServiceFeeBps: 1200, hostCommissionBps: 300 }, nightlyRates: [{ date: "2027-01-01", cents: 25_000 }, { date: "2027-01-02", cents: 25_000 }] },
  });
  const payment = { status: "SUCCEEDED" as const, amountCents: split.guestTotalCents, refundedCents: 0, currency: "AUD", processingFeeCents: null };
  const codes = (b: Partial<ReconcileBooking>, payments = [payment], refunds: { status: "SUCCEEDED" | "PENDING" | "FAILED" | "CANCELLED"; amountCents: number; currency: string }[] = []) =>
    reconcileBooking({ ...booking, ...b }, payments, refunds).issues.map((i) => i.code);

  it("a correct booking reconciles cleanly and reports gross (not net) figures", () => {
    const r = reconcileBooking(booking, [payment], []);
    expect(r.issues).toEqual([]);
    expect(r.guestTotalCents).toBe(r.estimatedHostProceedsCents + r.platformGrossRevenueCents);
    expect(r.paidCents).toBe(booking.totalCents);
    // No processing fee reported → net platform amount is NOT invented.
    expect(r.processingFeeCents).toBeNull();
    expect(r.netPlatformCents).toBeNull();
  });

  it("uses a processing fee only when the provider reported it", () => {
    const r = reconcileBooking(booking, [{ ...payment, processingFeeCents: 1_000 }], []);
    expect(r.netPlatformCents).toBe(booking.platformRevenueCents - 1_000);
  });

  it("flags guest-total, fee, commission and proceeds inconsistencies", () => {
    expect(codes({ totalCents: booking.totalCents + 1 })).toContain("guest_total_mismatch");
    expect(codes({ guestServiceFeeCents: booking.guestServiceFeeCents + 1, totalCents: booking.totalCents + 1, platformRevenueCents: booking.platformRevenueCents + 1 })).toContain("guest_fee_mismatch");
    expect(codes({ hostCommissionCents: booking.hostCommissionCents + 1 })).toEqual(expect.arrayContaining(["commission_mismatch", "platform_revenue_mismatch"]));
    expect(codes({ hostPayoutCents: booking.hostPayoutCents - 1 })).toEqual(expect.arrayContaining(["host_proceeds_mismatch", "split_mismatch"]));
    expect(codes({ guestServiceFeeBps: 1300 })).toEqual(expect.arrayContaining(["guest_fee_mismatch", "fee_snapshot_mismatch"]));
    expect(codes({ accommodationCents: 49_000 })).toContain("nightly_rates_mismatch");
  });

  it("flags currency mismatches, over-refunds and impossible refund states", () => {
    expect(codes({}, [{ ...payment, currency: "NZD" }])).toContain("currency_mismatch");
    expect(codes({}, [{ ...payment, refundedCents: payment.amountCents + 1 }])).toContain("over_refunded");
    expect(codes({}, [payment], [{ status: "SUCCEEDED", amountCents: payment.amountCents, currency: "AUD" }, { status: "PENDING", amountCents: 1, currency: "AUD" }])).toContain("refund_ledger_exceeds_payment");
    expect(codes({ status: "REFUNDED", refundDueCents: 10_000 })).toContain("refund_state_mismatch");
    expect(codes({}, [{ ...payment, amountCents: payment.amountCents - 1 }])).toContain("payment_amount_mismatch");
  });

  it("flags a paid-status booking without a captured payment (except demo data)", () => {
    expect(codes({}, [])).toContain("no_captured_payment");
    expect(codes({ isDemo: true }, [])).not.toContain("no_captured_payment");
  });

  it("never mutates what it checks", () => {
    expect(() => reconcileBooking(booking, [Object.freeze({ ...payment })], [])).not.toThrow();
  });

  it("can't verify unknown pricing-rule versions automatically — says so instead of guessing", () => {
    expect(codes({ pricingSnapshot: { rulesVersion: "legacy" } })).toEqual(["unknown_rules_version"]);
  });
});

describe("commission changes are validated and never back-dated", () => {
  const now = new Date("2027-03-01T01:00:00Z"); // 12:00 in Sydney
  const valid = { name: "2027 fees", guestServiceFeeBps: "12.5", hostCommissionBps: "3", effectiveDate: "2027-03-02", reason: "Annual fee review approved", confirmed: "on" };

  it("parses percentages to basis points with integer arithmetic", () => {
    expect(parsePercentToBps("12.5")).toBe(1250);
    expect(parsePercentToBps("0")).toBe(0);
    expect(parsePercentToBps("12.05%")).toBe(1205);
    for (const bad of ["12.345", "-1", "1e1", "abc", "100", ""]) expect(parsePercentToBps(bad)).toBeNull();
    expect(formatBps(1250)).toBe("12.5%");
    expect(formatBps(1205)).toBe("12.05%");
    expect(formatBps(300)).toBe("3%");
  });

  it("enforces configured bounds and a confirmation", () => {
    expect(commissionScheduleSchema.safeParse(valid).success).toBe(true);
    expect(commissionScheduleSchema.safeParse({ ...valid, guestServiceFeeBps: "25" }).success).toBe(false);
    expect(commissionScheduleSchema.safeParse({ ...valid, hostCommissionBps: "26" }).success).toBe(false);
    expect(commissionScheduleSchema.safeParse({ ...valid, confirmed: "" }).success).toBe(false);
    expect(commissionScheduleSchema.safeParse({ ...valid, reason: "x" }).success).toBe(false);
    expect(COMMISSION_BOUNDS.guestServiceFeeBps.max).toBeLessThanOrEqual(5000);
  });

  it("rejects past dates; today applies now; future dates start at Sydney midnight", () => {
    expect(resolveEffectiveFrom("2027-02-28", now).ok).toBe(false);
    expect(resolveEffectiveFrom("2027-03-01", now)).toEqual({ ok: true, effectiveFrom: now });
    expect(resolveEffectiveFrom("2027-03-02", now)).toEqual({ ok: true, effectiveFrom: new Date("2027-03-01T13:00:00Z") });
    expect(resolveEffectiveFrom("2029-03-02", now).ok).toBe(false);
  });

  it("derives schedule state the same way pricing picks the active schedule", () => {
    const s = [
      { id: "old", effectiveFrom: new Date("2026-01-01") },
      { id: "current", effectiveFrom: new Date("2027-01-01") },
      { id: "future", effectiveFrom: new Date("2027-06-01") },
    ];
    expect(Object.fromEntries(scheduleStates(s, now))).toEqual({ old: "superseded", current: "active", future: "scheduled" });
  });
});

describe("reporting ranges", () => {
  const now = new Date("2026-10-06T02:00:00Z"); // 13:00, 6 Oct in Sydney (AEDT)

  it("computes local-midnight boundaries across daylight saving", () => {
    expect(startOfDayIn("2026-10-05").toISOString()).toBe("2026-10-04T13:00:00.000Z"); // AEDT +11
    expect(startOfDayIn("2026-06-01").toISOString()).toBe("2026-05-31T14:00:00.000Z"); // AEST +10
  });

  it("supports presets and validated custom ranges", () => {
    expect(resolveRange({ range: "7d" }, now)).toMatchObject({ firstDay: "2026-09-30", lastDay: "2026-10-06" });
    expect(resolveRange({}, now)).toMatchObject({ preset: "30d", firstDay: "2026-09-07", lastDay: "2026-10-06" });
    expect(resolveRange({ range: "this_month" }, now)).toMatchObject({ firstDay: "2026-10-01", lastDay: "2026-10-06" });
    expect(resolveRange({ range: "prev_month" }, now)).toMatchObject({ firstDay: "2026-09-01", lastDay: "2026-09-30" });
    expect(resolveRange({ range: "custom", from: "2026-08-01", to: "2026-08-31" }, now)).toMatchObject({ preset: "custom", invalid: false });
  });

  it("falls back to 30 days for invalid, reversed, future or too-long custom ranges", () => {
    for (const bad of [{ from: "2026-09-10", to: "2026-09-01" }, { from: "2025-01-01", to: "2026-10-01" }, { from: "2026-10-01", to: "2026-12-01" }, { from: "nope", to: "2026-10-01" }]) {
      expect(resolveRange({ range: "custom", ...bad }, now)).toMatchObject({ preset: "30d", invalid: true });
    }
    expect(resolveRange({ range: "'; DROP TABLE" }, now).preset).toBe("30d");
  });
});

describe("admin query parameters are validated", () => {
  it("clamps pages, cleans search text and allow-lists enums", () => {
    expect(parsePage({ page: "3" })).toBe(3);
    expect(parsePage({ page: "-1" })).toBe(1);
    expect(parsePage({ page: "1.5" })).toBe(1);
    expect(parsePage({ page: "999999" })).toBe(2000);
    expect(parseQuery({ q: "  ROA\u0000-ABC  " })).toBe("ROA-ABC");
    expect(parseQuery({ q: "x".repeat(500) })?.length).toBe(100);
    expect(parseQuery({ q: "   " })).toBeUndefined();
    expect(oneOf({ status: "CONFIRMED" }, "status", ["CONFIRMED", "CANCELLED"] as const)).toBe("CONFIRMED");
    expect(oneOf({ status: "ADMIN" }, "status", ["CONFIRMED"] as const)).toBeUndefined();
    expect(listHref("/admin/bookings", { q: "a b", status: undefined, page: 1 })).toBe("/admin/bookings?q=a+b");
  });
});

describe("audit records are append-only in code", () => {
  it("no source file updates or deletes AdminAction, AuditLog or AdminNote rows", () => {
    const root = path.resolve(import.meta.dirname, "../../src");
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const full = path.join(dir, name);
        if (name === "generated") continue;
        if (statSync(full).isDirectory()) walk(full);
        else if (/\.(ts|tsx)$/.test(name)) files.push(full);
      }
    };
    walk(root);
    const offenders = files.filter((f) => /\b(adminAction|auditLog|adminNote)\.(update|updateMany|upsert|delete|deleteMany)\b/.test(readFileSync(f, "utf8")));
    expect(offenders).toEqual([]);
  });
});
