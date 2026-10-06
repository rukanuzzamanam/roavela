import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { BookingStatus, PaymentStatus } from "@/generated/prisma/enums";
import { ADMIN_PAGE_SIZE } from "@/lib/admin/query";
import { reconcileBooking } from "@/lib/admin/reconciliation";
import { maxRefundableCents, outstandingPolicyRefundCents, REFUNDABLE_PAYMENT_STATUSES } from "@/lib/admin/refunds";
import { isIsoDate, parseIsoDate } from "@/lib/dates";
import { isPlausibleReference } from "@/lib/validation/booking";
import { prisma } from "@/server/db";
import { cancellationPreview } from "@/server/services/checkout";
import { getHistory, listNotes } from "./history";

/**
 * Booking and payment oversight (read side). Admin-only. Card data never reaches Roavela, and
 * provider secrets/client secrets are never selected — only provider ids, statuses and amounts.
 */
export const BOOKING_STATUSES = Object.values(BookingStatus);
export const PAYMENT_STATUSES = Object.values(PaymentStatus);

export interface BookingFilters {
  q?: string;
  status?: BookingStatus;
  paymentStatus?: PaymentStatus;
  /** Check-in date range (inclusive ISO dates). */
  from?: string;
  to?: string;
  page: number;
}

function bookingWhere(f: BookingFilters): Prisma.BookingWhereInput {
  const and: Prisma.BookingWhereInput[] = [];
  if (f.status) and.push({ status: f.status });
  if (f.paymentStatus) and.push({ payments: { some: { status: f.paymentStatus } } });
  if (f.from && isIsoDate(f.from)) and.push({ checkIn: { gte: parseIsoDate(f.from) } });
  if (f.to && isIsoDate(f.to)) and.push({ checkIn: { lte: parseIsoDate(f.to) } });
  if (f.q) {
    const q = f.q;
    const upper = q.toUpperCase();
    and.push({
      OR: [
        ...(isPlausibleReference(upper) ? [{ reference: upper }] : [{ reference: { startsWith: upper } }]),
        { guest: { email: { contains: q.toLowerCase() } } },
        { guest: { name: { contains: q, mode: "insensitive" } } },
        { property: { title: { contains: q, mode: "insensitive" } } },
        { property: { host: { displayName: { contains: q, mode: "insensitive" } } } },
        { property: { host: { user: { email: { contains: q.toLowerCase() } } } } },
        { payments: { some: { providerPaymentId: q } } },
      ],
    });
  }
  return and.length > 0 ? { AND: and } : {};
}

export async function listAdminBookings(f: BookingFilters) {
  const where = bookingWhere(f);
  const [total, rows] = await Promise.all([
    prisma.booking.count({ where }),
    prisma.booking.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      skip: (f.page - 1) * ADMIN_PAGE_SIZE,
      take: ADMIN_PAGE_SIZE,
      select: {
        id: true,
        reference: true,
        status: true,
        checkIn: true,
        checkOut: true,
        nights: true,
        adults: true,
        children: true,
        currency: true,
        totalCents: true,
        platformRevenueCents: true,
        hostPayoutCents: true,
        isDemo: true,
        createdAt: true,
        property: { select: { id: true, title: true, host: { select: { displayName: true, userId: true } } } },
        guest: { select: { id: true, name: true } },
        payments: { select: { status: true, provider: true } },
      },
    }),
  ]);
  return { total, rows };
}

export async function getAdminBooking(reference: string, now = new Date()) {
  if (!isPlausibleReference(reference)) return null;
  const b = await prisma.booking.findUnique({
    where: { reference },
    include: {
      property: { select: { id: true, title: true, slug: true, timezone: true, status: true, host: { select: { displayName: true, user: { select: { id: true, name: true, email: true, status: true } } } } } },
      guest: { select: { id: true, name: true, email: true, status: true } },
      payments: {
        select: { id: true, provider: true, providerPaymentId: true, status: true, amountCents: true, refundedCents: true, currency: true, processingFeeCents: true, failureCode: true, createdAt: true, updatedAt: true },
      },
      refunds: {
        orderBy: { createdAt: "asc" },
        select: { id: true, paymentId: true, amountCents: true, currency: true, status: true, reason: true, providerRefundId: true, failureCode: true, confirmedAt: true, createdAt: true, requestedBy: { select: { name: true } } },
      },
      feeSchedule: { select: { id: true, name: true } },
    },
  });
  if (!b) return null;

  const paymentIds = b.payments.map((p) => p.id);
  const [webhookEvents, history, notes] = await Promise.all([
    paymentIds.length
      ? prisma.webhookEvent.findMany({ where: { paymentId: { in: paymentIds } }, orderBy: { receivedAt: "asc" }, take: 50, select: { id: true, provider: true, externalEventId: true, eventType: true, status: true, message: true, receivedAt: true } })
      : Promise.resolve([]),
    getHistory("Booking", b.id),
    listNotes("Booking", b.id),
  ]);

  const reconciliation = reconcileBooking(b, b.payments, b.refunds);
  const captured = b.payments.find((p) => REFUNDABLE_PAYMENT_STATUSES.includes(p.status)) ?? null;
  const ledger = captured ? b.refunds.filter((r) => r.paymentId === captured.id) : [];
  const refund = captured
    ? {
        paymentId: captured.id,
        provider: captured.provider,
        paidCents: captured.amountCents,
        providerRefundedCents: captured.refundedCents,
        inFlightCents: ledger.filter((r) => r.status === "PENDING").reduce((t, r) => t + r.amountCents, 0),
        maxRefundableCents: maxRefundableCents(captured, ledger),
        outstandingPolicyCents: b.status === "REFUND_PENDING" ? outstandingPolicyRefundCents(b.refundDueCents, captured, ledger) : 0,
      }
    : null;
  const cancelQuote = cancellationPreview(b, b.property.timezone, now);

  return { booking: b, webhookEvents, history, notes, reconciliation, refund, cancelQuote };
}
export type AdminBooking = NonNullable<Awaited<ReturnType<typeof getAdminBooking>>>;

// ── Payments ──────────────────────────────────────────────────────────────────

export async function listAdminPayments({ q, status, provider, page }: { q?: string; status?: PaymentStatus; provider?: "stripe" | "mock"; page: number }) {
  const where: Prisma.PaymentWhereInput = {
    ...(status ? { status } : {}),
    ...(provider ? { provider } : {}),
    ...(q ? { OR: [{ providerPaymentId: q }, { id: q }, { booking: { reference: q.toUpperCase() } }] } : {}),
  };
  const [total, rows] = await Promise.all([
    prisma.payment.count({ where }),
    prisma.payment.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      skip: (page - 1) * ADMIN_PAGE_SIZE,
      take: ADMIN_PAGE_SIZE,
      select: {
        id: true,
        provider: true,
        providerPaymentId: true,
        status: true,
        amountCents: true,
        refundedCents: true,
        currency: true,
        failureCode: true,
        createdAt: true,
        updatedAt: true,
        booking: { select: { reference: true, isDemo: true } },
        refunds: { select: { status: true } },
      },
    }),
  ]);
  return { total, rows };
}

// ── Reconciliation ────────────────────────────────────────────────────────────

/** Paid bookings (by confirmation time) whose figures are checked; bounded per page. */
const RECONCILABLE: BookingStatus[] = ["CONFIRMED", "COMPLETED", "CANCELLED", "REFUND_PENDING", "REFUNDED"];
/** Scanning cap for "issues only": reconciliation runs in code, so the scan is bounded. */
export const RECONCILE_SCAN_LIMIT = 2000;

const reconcileSelect = {
  id: true,
  reference: true,
  status: true,
  isDemo: true,
  currency: true,
  accommodationCents: true,
  cleaningFeeCents: true,
  guestServiceFeeCents: true,
  totalCents: true,
  hostCommissionCents: true,
  hostPayoutCents: true,
  platformRevenueCents: true,
  guestServiceFeeBps: true,
  hostCommissionBps: true,
  refundDueCents: true,
  pricingSnapshot: true,
  confirmedAt: true,
  payments: { select: { status: true, amountCents: true, refundedCents: true, currency: true, processingFeeCents: true } },
  refunds: { select: { status: true, amountCents: true, currency: true } },
} satisfies Prisma.BookingSelect;

export async function listReconciliation({ from, to, issuesOnly, page }: { from: Date; to: Date; issuesOnly: boolean; page: number }) {
  const where: Prisma.BookingWhereInput = { status: { in: RECONCILABLE }, confirmedAt: { gte: from, lt: to } };
  if (!issuesOnly) {
    const [total, rows] = await Promise.all([
      prisma.booking.count({ where }),
      prisma.booking.findMany({ where, orderBy: [{ confirmedAt: "desc" }, { id: "asc" }], skip: (page - 1) * ADMIN_PAGE_SIZE, take: ADMIN_PAGE_SIZE, select: reconcileSelect }),
    ]);
    return { total, truncated: false, rows: rows.map((b) => ({ ...b, reconciliation: reconcileBooking(b, b.payments, b.refunds) })) };
  }
  const scanned = await prisma.booking.findMany({ where, orderBy: [{ confirmedAt: "desc" }, { id: "asc" }], take: RECONCILE_SCAN_LIMIT + 1, select: reconcileSelect });
  const truncated = scanned.length > RECONCILE_SCAN_LIMIT;
  const flagged = scanned
    .slice(0, RECONCILE_SCAN_LIMIT)
    .map((b) => ({ ...b, reconciliation: reconcileBooking(b, b.payments, b.refunds) }))
    .filter((b) => b.reconciliation.issues.length > 0);
  return { total: flagged.length, truncated, rows: flagged.slice((page - 1) * ADMIN_PAGE_SIZE, page * ADMIN_PAGE_SIZE) };
}
