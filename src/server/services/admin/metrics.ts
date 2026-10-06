import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { addDays, todayInTimeZone } from "@/lib/dates";
import { ADMIN_TIMEZONE, type DateRange } from "@/lib/admin/ranges";
import { prisma } from "@/server/db";

/**
 * Dashboard metrics — real database aggregates only, never estimates or placeholders.
 * Formulas (also documented in the README):
 *
 *  Cohort: bookings CONFIRMED within the range (by confirmedAt) — i.e. paid bookings — whatever their
 *  status now (confirmed, completed, cancelled or refunded). Demo (seeded) bookings are excluded.
 *
 *  GBV (gross booking value)    = Σ guest totals of the cohort, before refunds.
 *  Platform gross revenue       = Σ (guest service fee + host commission) of the cohort, minus that
 *                                 revenue for bookings that were refunded IN FULL (the guest got the
 *                                 service fee back). Partial refunds aren't allocated between host
 *                                 and platform yet, so they are reported separately. NOT profit:
 *                                 processing fees and costs are not deducted.
 *  Refunds                       = Σ refunds the provider has confirmed, created within the range.
 *  Cancellation rate             = cohort bookings now cancelled/refunded ÷ cohort size.
 *  Average booking value         = GBV ÷ cohort size.
 */
const COHORT_STATUSES = ["CONFIRMED", "COMPLETED", "CANCELLED", "REFUND_PENDING", "REFUNDED"] as const;
const CANCELLED_STATUSES = ["CANCELLED", "REFUND_PENDING", "REFUNDED"] as const;

export interface DashboardMetrics {
  range: DateRange;
  bookings: { confirmed: number; cancelled: number; cancellationRateBps: number | null; demoExcluded: number };
  money: { currency: string; gbvCents: number; platformGrossCents: number; platformReversedCents: number; refundsCents: number; averageBookingCents: number | null; otherCurrencies: string[] };
  marketplace: { totalUsers: number; customers: number; activeHosts: number; publishedProperties: number; awaitingReview: number; underReview: number; complianceToReview: number };
}

export async function getDashboardMetrics(range: DateRange): Promise<DashboardMetrics> {
  const cohort: Prisma.BookingWhereInput = { isDemo: false, status: { in: [...COHORT_STATUSES] }, confirmedAt: { gte: range.from, lt: range.to } };

  const [byCurrency, cancelled, fullyRefunded, refunds, demoExcluded, totalUsers, customers, activeHosts, published, awaiting, underReview, complianceToReview] = await Promise.all([
    prisma.booking.groupBy({ by: ["currency"], where: cohort, _count: { _all: true }, _sum: { totalCents: true, platformRevenueCents: true } }),
    prisma.booking.count({ where: { ...cohort, status: { in: [...CANCELLED_STATUSES] } } }),
    // Fully refunded: the provider-confirmed refund covers the whole guest total.
    prisma.$queryRaw<{ currency: string; reversed: bigint | null }[]>`
      SELECT b."currency", SUM(b."platformRevenueCents")::bigint AS reversed
      FROM "Booking" b
      WHERE b."isDemo" = false AND b."status"::text = 'REFUNDED' AND b."confirmedAt" >= ${range.from} AND b."confirmedAt" < ${range.to}
        AND (SELECT COALESCE(SUM(p."refundedCents"), 0) FROM "Payment" p WHERE p."bookingId" = b."id") >= b."totalCents"
      GROUP BY b."currency"`,
    prisma.refund.groupBy({ by: ["currency"], where: { status: "SUCCEEDED", createdAt: { gte: range.from, lt: range.to }, booking: { isDemo: false } }, _sum: { amountCents: true } }),
    prisma.booking.count({ where: { ...cohort, isDemo: true } }),
    prisma.user.count(),
    prisma.user.count({ where: { role: "CUSTOMER" } }),
    // Active host = ACTIVE account with at least one live listing.
    prisma.hostProfile.count({ where: { user: { status: "ACTIVE" }, properties: { some: { status: "PUBLISHED" } } } }),
    prisma.property.count({ where: { status: "PUBLISHED" } }),
    prisma.property.count({ where: { status: "PENDING_REVIEW", reviewStartedAt: null } }),
    prisma.property.count({ where: { status: "PENDING_REVIEW", reviewStartedAt: { not: null } } }),
    prisma.complianceDocument.count({ where: { status: { in: ["SUBMITTED", "UNDER_REVIEW"] }, propertyId: { not: null } } }),
  ]);

  // Money is never summed across currencies. Report the primary (AUD) and list any others.
  const currency = "AUD";
  const primary = byCurrency.find((r) => r.currency === currency);
  const confirmed = byCurrency.reduce((t, r) => t + r._count._all, 0);
  const gbvCents = primary?._sum.totalCents ?? 0;
  const reversed = Number(fullyRefunded.find((r) => r.currency === currency)?.reversed ?? 0);
  const primaryCount = primary?._count._all ?? 0;

  return {
    range,
    bookings: { confirmed, cancelled, cancellationRateBps: confirmed > 0 ? Math.round((cancelled * 10_000) / confirmed) : null, demoExcluded },
    money: {
      currency,
      gbvCents,
      platformGrossCents: (primary?._sum.platformRevenueCents ?? 0) - reversed,
      platformReversedCents: reversed,
      refundsCents: refunds.find((r) => r.currency === currency)?._sum.amountCents ?? 0,
      averageBookingCents: primaryCount > 0 ? Math.round(gbvCents / primaryCount) : null,
      otherCurrencies: byCurrency.map((r) => r.currency).filter((c) => c !== currency),
    },
    marketplace: { totalUsers, customers, activeHosts, publishedProperties: published, awaitingReview: awaiting, underReview, complianceToReview },
  };
}

export interface AttentionItem {
  key: string;
  count: number;
  label: string;
  href: string;
}

/** Operational queue counts — simple, database-backed. "Needs review", never accusations. */
export async function getAttentionItems(now = new Date()): Promise<AttentionItem[]> {
  const today = todayInTimeZone(ADMIN_TIMEZONE, now);
  const [awaiting, compliance, expired, expiring, refundPending, refundFailed, suspendedHostBookings, failedPayments] = await Promise.all([
    prisma.property.count({ where: { status: "PENDING_REVIEW" } }),
    prisma.complianceDocument.count({ where: { status: { in: ["SUBMITTED", "UNDER_REVIEW"] }, propertyId: { not: null } } }),
    prisma.complianceDocument.count({ where: { propertyId: { not: null }, OR: [{ status: "EXPIRED" }, { expiresAt: { lt: today } }], property: { status: { in: ["PUBLISHED", "PAUSED", "PENDING_REVIEW"] } } } }),
    prisma.complianceDocument.count({ where: { propertyId: { not: null }, status: { not: "EXPIRED" }, expiresAt: { gte: today, lte: addDays(today, 30) } } }),
    prisma.booking.count({ where: { status: "REFUND_PENDING" } }),
    prisma.refund.count({ where: { status: "FAILED", booking: { status: "REFUND_PENDING" } } }),
    prisma.booking.count({ where: { status: "CONFIRMED", checkOut: { gt: today }, property: { host: { user: { status: "SUSPENDED" } } } } }),
    prisma.payment.count({ where: { status: "FAILED", updatedAt: { gte: addDays(now, -7) } } }),
  ]);
  const items: AttentionItem[] = [
    { key: "review", count: awaiting, label: "properties awaiting review", href: "/admin/properties?filter=pending" },
    { key: "compliance", count: compliance, label: "compliance records to review", href: "/admin/compliance" },
    { key: "expired", count: expired, label: "compliance records expired on active listings", href: "/admin/compliance?filter=expired" },
    { key: "expiring", count: expiring, label: "compliance records expiring within 30 days", href: "/admin/compliance?filter=expiring" },
    { key: "refunds", count: refundPending, label: "bookings awaiting refund confirmation", href: "/admin/refunds" },
    { key: "refund_failed", count: refundFailed, label: "failed refund requests need action", href: "/admin/refunds" },
    { key: "suspended_host_bookings", count: suspendedHostBookings, label: "upcoming bookings with suspended hosts need handling", href: "/admin/hosts?status=SUSPENDED" },
    { key: "failed_payments", count: failedPayments, label: "failed payments in the last 7 days", href: "/admin/payments?status=FAILED" },
  ];
  return items.filter((i) => i.count > 0);
}
