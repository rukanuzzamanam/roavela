import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { Prisma as P } from "@/generated/prisma/client";
import type { UserStatus } from "@/generated/prisma/enums";
import { ADMIN_PAGE_SIZE } from "@/lib/admin/query";
import { todayInTimeZone } from "@/lib/dates";
import { prisma } from "@/server/db";
import { accountReactivatedEmail, accountSuspendedEmail, sendAdminEmail } from "@/server/emails/admin-emails";
import { track } from "@/server/providers/analytics";
import { cleanText, FORBIDDEN, fail, MIN_REASON, ok, permitted, recordAdminAction, STALE, type AdminActor, type AdminResult } from "./common";
import { getHistory, listNotes } from "./history";

/**
 * Host and customer administration.
 *
 * SUSPENSION — what it means (defined once, here):
 *  - The account's sessions are revoked immediately and it can't log in (getCurrentUser treats any
 *    non-ACTIVE account as signed out), so it can't create bookings, listings or submissions.
 *  - Host: every PUBLISHED or PAUSED listing becomes SUSPENDED (hidden, unbookable). Listings in
 *    review stay where they are, but can't be approved while the host is suspended.
 *  - Existing CONFIRMED bookings are NOT cancelled or refunded automatically — they stay in place
 *    and are flagged for an admin to handle explicitly (cancel + refund is a separate, audited action).
 *  - Nothing is deleted: bookings, payments, reviews and history are kept.
 * Reactivation restores the account; listings suspended BY the host suspension come back as PAUSED
 * (the host chooses when to go live again). Listings suspended individually stay suspended.
 *
 * Admin accounts are not managed here (and an admin can never suspend themselves).
 */
const LIVE_BOOKING = ["CONFIRMED", "COMPLETED"] as const;

export async function listHosts({ q, status, page }: { q?: string; status?: UserStatus; page: number }) {
  const where: Prisma.UserWhereInput = {
    role: "HOST",
    ...(status ? { status } : {}),
    ...(q ? { OR: [{ email: { contains: q.toLowerCase() } }, { name: { contains: q, mode: "insensitive" } }, { hostProfile: { displayName: { contains: q, mode: "insensitive" } } }] } : {}),
  };
  const today = todayInTimeZone("Australia/Sydney");
  const [total, users] = await Promise.all([
    prisma.user.count({ where }),
    prisma.user.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      skip: (page - 1) * ADMIN_PAGE_SIZE,
      take: ADMIN_PAGE_SIZE,
      select: {
        id: true,
        name: true,
        status: true,
        isDemo: true,
        createdAt: true,
        hostProfile: {
          select: {
            id: true,
            displayName: true,
            onboardingStatus: true,
            _count: {
              select: {
                properties: true,
                complianceDocuments: { where: { OR: [{ status: { in: ["REJECTED", "EXPIRED"] } }, { expiresAt: { lt: today } }] } },
              },
            },
          },
        },
      },
    }),
  ]);
  const hostIds = users.flatMap((u) => (u.hostProfile ? [u.hostProfile.id] : []));
  // Two grouped queries for the whole page — no per-row (N+1) queries.
  const [published, bookings] = hostIds.length
    ? await Promise.all([
        prisma.property.groupBy({ by: ["hostId"], where: { hostId: { in: hostIds }, status: "PUBLISHED" }, _count: { _all: true } }),
        prisma.$queryRaw<{ hostId: string; count: bigint }[]>`
          SELECT p."hostId", COUNT(*)::bigint AS count FROM "Booking" b JOIN "Property" p ON p."id" = b."propertyId"
          WHERE p."hostId" IN (${P.join(hostIds)}) AND b."status"::text IN ('CONFIRMED','COMPLETED','CANCELLED','REFUND_PENDING','REFUNDED')
          GROUP BY p."hostId"`,
      ])
    : [[], []];
  const publishedBy = new Map(published.map((r) => [r.hostId, r._count._all]));
  const bookingsBy = new Map(bookings.map((r) => [r.hostId, Number(r.count)]));
  return {
    total,
    rows: users.map((u) => ({
      ...u,
      propertyCount: u.hostProfile?._count.properties ?? 0,
      publishedCount: u.hostProfile ? (publishedBy.get(u.hostProfile.id) ?? 0) : 0,
      bookingCount: u.hostProfile ? (bookingsBy.get(u.hostProfile.id) ?? 0) : 0,
      complianceIssues: u.hostProfile?._count.complianceDocuments ?? 0,
    })),
  };
}

export async function getAdminHost(userId: string) {
  if (userId.length > 64) return null;
  const user = await prisma.user.findFirst({
    where: { id: userId, role: "HOST" },
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      status: true,
      isDemo: true,
      createdAt: true,
      lastLoginAt: true,
      updatedAt: true,
      hostProfile: {
        select: {
          id: true,
          displayName: true,
          bio: true,
          hostType: true,
          legalName: true,
          businessName: true,
          abn: true,
          phone: true,
          onboardingStatus: true,
          payoutsEnabled: true,
          properties: { orderBy: { updatedAt: "desc" }, take: 100, select: { id: true, title: true, status: true, isDemo: true, updatedAt: true } },
          complianceDocuments: { select: { id: true, type: true, status: true, expiresAt: true, propertyId: true } },
        },
      },
    },
  });
  if (!user) return null;
  const hostId = user.hostProfile?.id;
  const today = todayInTimeZone("Australia/Sydney");
  const [byStatus, upcoming, history, notes] = await Promise.all([
    hostId ? prisma.booking.groupBy({ by: ["status"], where: { property: { hostId } }, _count: { _all: true } }) : Promise.resolve([]),
    hostId
      ? prisma.booking.findMany({
          where: { property: { hostId }, status: "CONFIRMED", checkOut: { gt: today } },
          orderBy: { checkIn: "asc" },
          take: 20,
          select: { reference: true, checkIn: true, checkOut: true, totalCents: true, currency: true, property: { select: { title: true } } },
        })
      : Promise.resolve([]),
    getHistory("User", user.id),
    listNotes("User", user.id),
  ]);
  const bookingCounts = Object.fromEntries(byStatus.map((r) => [r.status, r._count._all])) as Record<string, number>;
  const docs = user.hostProfile?.complianceDocuments ?? [];
  const issues: string[] = [];
  const expired = docs.filter((d) => d.status === "EXPIRED" || (d.expiresAt && d.expiresAt < today)).length;
  if (expired) issues.push(`${expired} compliance record(s) expired — needs review`);
  const rejected = docs.filter((d) => d.status === "REJECTED").length;
  if (rejected) issues.push(`${rejected} compliance record(s) need correction`);
  const suspendedListings = user.hostProfile?.properties.filter((p) => p.status === "SUSPENDED").length ?? 0;
  if (suspendedListings) issues.push(`${suspendedListings} listing(s) suspended`);
  const confirmed = (bookingCounts.CONFIRMED ?? 0) + (bookingCounts.COMPLETED ?? 0);
  const cancelled = (bookingCounts.CANCELLED ?? 0) + (bookingCounts.REFUND_PENDING ?? 0) + (bookingCounts.REFUNDED ?? 0);
  if (cancelled >= 3 && cancelled / Math.max(1, confirmed + cancelled) >= 0.3) issues.push("High cancellation rate — needs review");
  if (user.status === "SUSPENDED" && upcoming.length) issues.push(`${upcoming.length} upcoming confirmed booking(s) need admin handling`);
  return { user, bookingCounts, upcoming, issues, history, notes };
}

export async function listCustomers({ q, status, page }: { q?: string; status?: UserStatus; page: number }) {
  const where: Prisma.UserWhereInput = {
    role: "CUSTOMER",
    ...(status ? { status } : {}),
    ...(q ? { OR: [{ email: { contains: q.toLowerCase() } }, { name: { contains: q, mode: "insensitive" } }] } : {}),
  };
  const [total, rows] = await Promise.all([
    prisma.user.count({ where }),
    prisma.user.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      skip: (page - 1) * ADMIN_PAGE_SIZE,
      take: ADMIN_PAGE_SIZE,
      select: { id: true, name: true, email: true, status: true, isDemo: true, createdAt: true, _count: { select: { bookings: { where: { status: { in: [...LIVE_BOOKING, "CANCELLED", "REFUND_PENDING", "REFUNDED"] } } } } } },
    }),
  ]);
  return { total, rows };
}

export async function getAdminCustomer(userId: string) {
  if (userId.length > 64) return null;
  const user = await prisma.user.findFirst({
    where: { id: userId, role: "CUSTOMER" },
    select: { id: true, name: true, email: true, phone: true, status: true, isDemo: true, createdAt: true, lastLoginAt: true, updatedAt: true },
  });
  if (!user) return null;
  const [bookings, reviews, failedPayments, history, notes] = await Promise.all([
    prisma.booking.findMany({
      where: { guestId: user.id, status: { not: "EXPIRED" } },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: { reference: true, status: true, checkIn: true, checkOut: true, totalCents: true, currency: true, cancelledAt: true, cancellationReason: true, refundDueCents: true, isDemo: true, property: { select: { title: true } } },
    }),
    prisma.review.findMany({ where: { authorId: user.id }, orderBy: { createdAt: "desc" }, take: 20, select: { id: true, overallRating: true, status: true, createdAt: true, property: { select: { title: true } } } }),
    prisma.payment.count({ where: { status: "FAILED", booking: { guestId: user.id }, updatedAt: { gte: new Date(Date.now() - 30 * 86_400_000) } } }),
    getHistory("User", user.id),
    listNotes("User", user.id),
  ]);
  const issues: string[] = [];
  if (failedPayments >= 3) issues.push(`${failedPayments} failed payments in 30 days — needs review`);
  return { user, bookings, reviews, issues, history, notes };
}

// ── Suspension ────────────────────────────────────────────────────────────────

export async function suspendAccount(actor: AdminActor, input: { userId: string; reason: unknown; expectedUpdatedAt: Date | null }): Promise<AdminResult<{ listingsSuspended: number; upcomingBookings: number }>> {
  if (!permitted(actor, "admin:users:manage")) return FORBIDDEN();
  const reason = cleanText(input.reason, 1000);
  if (reason.length < MIN_REASON) return fail("invalid", "A reason is required to suspend an account (at least 5 characters).");
  if (input.userId === actor.id) return fail("invalid", "You can't suspend your own account.");

  const user = await prisma.user.findUnique({ where: { id: input.userId }, select: { id: true, role: true, status: true, email: true, updatedAt: true, hostProfile: { select: { id: true } } } });
  if (!user || user.role === "ADMIN") return fail("not_found", "Account not found.");
  if (!input.expectedUpdatedAt || user.updatedAt.getTime() !== input.expectedUpdatedAt.getTime()) return STALE("account");
  if (user.status !== "ACTIVE") return fail("invalid_transition", "This account is already suspended.");

  const now = new Date();
  const result = await prisma.$transaction(async (tx) => {
    const updated = await tx.user.updateMany({ where: { id: user.id, status: "ACTIVE", updatedAt: user.updatedAt }, data: { status: "SUSPENDED" } });
    if (updated.count !== 1) return null;
    await tx.session.deleteMany({ where: { userId: user.id } });
    let propertyIds: string[] = [];
    let upcoming = 0;
    if (user.hostProfile) {
      const live = await tx.property.findMany({ where: { hostId: user.hostProfile.id, status: { in: ["PUBLISHED", "PAUSED"] } }, select: { id: true, status: true } });
      propertyIds = live.map((p) => p.id);
      if (propertyIds.length) await tx.property.updateMany({ where: { id: { in: propertyIds } }, data: { status: "SUSPENDED", reviewedAt: now } });
      for (const p of live) {
        await recordAdminAction(tx, { adminId: actor.id, action: "property.suspend", targetType: "Property", targetId: p.id, reason: `Host account suspended: ${reason}`, metadata: { from: p.status, to: "SUSPENDED", cause: "host_suspension" } });
      }
      upcoming = await tx.booking.count({ where: { property: { hostId: user.hostProfile.id }, status: "CONFIRMED", checkOut: { gt: now } } });
    }
    await recordAdminAction(tx, {
      adminId: actor.id,
      action: user.role === "HOST" ? "host.suspend" : "customer.suspend",
      targetType: "User",
      targetId: user.id,
      reason,
      metadata: { suspendedPropertyIds: propertyIds, upcomingConfirmedBookings: upcoming },
    });
    return { listingsSuspended: propertyIds.length, upcomingBookings: upcoming };
  });
  if (!result) return STALE("account");

  if (user.role === "HOST") track({ name: "host_suspended", properties: { hostUserId: user.id, listingsSuspended: result.listingsSuspended } });
  else track({ name: "customer_suspended", properties: { userId: user.id } });
  await sendAdminEmail("account_suspended", user.id, accountSuspendedEmail(user.email, reason));
  return ok(result);
}

export async function reactivateAccount(actor: AdminActor, input: { userId: string; reason: unknown; expectedUpdatedAt: Date | null }): Promise<AdminResult<{ listingsRestored: number }>> {
  if (!permitted(actor, "admin:users:manage")) return FORBIDDEN();
  const reason = cleanText(input.reason, 1000);
  if (reason.length < MIN_REASON) return fail("invalid", "A reason is required to reactivate an account (at least 5 characters).");

  const user = await prisma.user.findUnique({ where: { id: input.userId }, select: { id: true, role: true, status: true, email: true, updatedAt: true, hostProfile: { select: { id: true } } } });
  if (!user || user.role === "ADMIN") return fail("not_found", "Account not found.");
  if (!input.expectedUpdatedAt || user.updatedAt.getTime() !== input.expectedUpdatedAt.getTime()) return STALE("account");
  if (user.status !== "SUSPENDED") return fail("invalid_transition", "This account isn't suspended.");

  // Which listings did the most recent host suspension take down?
  const lastSuspension = await prisma.adminAction.findFirst({ where: { targetType: "User", targetId: user.id, action: "host.suspend" }, orderBy: { createdAt: "desc" }, select: { metadata: true } });
  const ids = ((lastSuspension?.metadata as { suspendedPropertyIds?: unknown } | null)?.suspendedPropertyIds ?? []) as unknown[];
  const propertyIds = user.hostProfile ? ids.filter((x): x is string => typeof x === "string") : [];

  const result = await prisma.$transaction(async (tx) => {
    const updated = await tx.user.updateMany({ where: { id: user.id, status: "SUSPENDED", updatedAt: user.updatedAt }, data: { status: "ACTIVE" } });
    if (updated.count !== 1) return null;
    let restored = 0;
    if (user.hostProfile && propertyIds.length) {
      // Only listings of THIS host that are still suspended; they return paused, never straight to live.
      const back = await tx.property.findMany({ where: { id: { in: propertyIds }, hostId: user.hostProfile.id, status: "SUSPENDED" }, select: { id: true } });
      if (back.length) await tx.property.updateMany({ where: { id: { in: back.map((p) => p.id) } }, data: { status: "PAUSED" } });
      for (const p of back) {
        await recordAdminAction(tx, { adminId: actor.id, action: "property.reinstate", targetType: "Property", targetId: p.id, reason: `Host account reactivated: ${reason}`, metadata: { from: "SUSPENDED", to: "PAUSED", cause: "host_reactivation" } });
      }
      restored = back.length;
    }
    await recordAdminAction(tx, { adminId: actor.id, action: user.role === "HOST" ? "host.reactivate" : "customer.reactivate", targetType: "User", targetId: user.id, reason, metadata: { listingsRestored: restored } });
    return { listingsRestored: restored };
  });
  if (!result) return STALE("account");
  track({ name: "account_reactivated", properties: { userId: user.id } });
  await sendAdminEmail("account_reactivated", user.id, accountReactivatedEmail(user.email));
  return ok(result);
}
