import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { jurisdictionFor } from "@/config/jurisdictions";
import { listingComplianceFlags } from "@/lib/admin/compliance";
import { ADMIN_PAGE_SIZE } from "@/lib/admin/query";
import { addDays, todayInTimeZone } from "@/lib/dates";
import { evaluateChecklist } from "@/lib/listing-checklist";
import { prisma } from "@/server/db";
import { buildSnapshot } from "@/server/services/host-properties";
import { getHistory, listNotes } from "./history";

/**
 * Admin property queue and review page. Admin-only reads: callers MUST have passed requireAdmin.
 * The private address and compliance details are included because reviewers legitimately need them.
 */
export const PROPERTY_FILTERS = ["pending", "under_review", "changes_requested", "published", "paused", "suspended", "rejected", "archived", "draft", "all"] as const;
export type PropertyFilter = (typeof PROPERTY_FILTERS)[number];

export const PROPERTY_FILTER_LABELS: Record<PropertyFilter, string> = {
  pending: "Pending review",
  under_review: "Under review",
  changes_requested: "Changes requested",
  published: "Published",
  paused: "Paused",
  suspended: "Suspended",
  rejected: "Rejected",
  archived: "Archived",
  draft: "Draft",
  all: "All",
};

const FILTER_WHERE: Record<PropertyFilter, Prisma.PropertyWhereInput> = {
  pending: { status: "PENDING_REVIEW", reviewStartedAt: null },
  under_review: { status: "PENDING_REVIEW", reviewStartedAt: { not: null } },
  changes_requested: { status: "CHANGES_REQUESTED" },
  published: { status: "PUBLISHED" },
  paused: { status: "PAUSED" },
  suspended: { status: "SUSPENDED" },
  rejected: { status: "REJECTED" },
  archived: { status: "ARCHIVED" },
  draft: { status: "DRAFT" },
  all: {},
};

export async function listAdminProperties({ filter, q, page }: { filter: PropertyFilter; q?: string; page: number }) {
  const where: Prisma.PropertyWhereInput = {
    ...FILTER_WHERE[filter],
    ...(q
      ? {
          OR: [
            { id: q },
            { title: { contains: q, mode: "insensitive" } },
            { slug: { contains: q.toLowerCase() } },
            { host: { displayName: { contains: q, mode: "insensitive" } } },
            { host: { user: { email: { contains: q.toLowerCase() } } } },
            { compliance: { some: { referenceNumber: { contains: q.toUpperCase() } } } },
          ],
        }
      : {}),
  };
  // Review queues are worked oldest-first; everything else shows the most recently changed first.
  const orderBy: Prisma.PropertyOrderByWithRelationInput[] = filter === "pending" || filter === "under_review" ? [{ submittedAt: "asc" }, { id: "asc" }] : [{ updatedAt: "desc" }, { id: "asc" }];
  const [total, rows] = await Promise.all([
    prisma.property.count({ where }),
    prisma.property.findMany({
      where,
      orderBy,
      skip: (page - 1) * ADMIN_PAGE_SIZE,
      take: ADMIN_PAGE_SIZE,
      select: {
        id: true,
        title: true,
        status: true,
        type: true,
        isDemo: true,
        locality: true,
        adminArea: true,
        submittedAt: true,
        updatedAt: true,
        reviewStartedAt: true,
        reviewStartedBy: { select: { name: true } },
        host: { select: { displayName: true, user: { select: { id: true, status: true } } } },
        _count: { select: { compliance: { where: { status: { in: ["SUBMITTED", "UNDER_REVIEW"] } } } } },
      },
    }),
  ]);
  return { total, rows };
}

export async function getAdminProperty(id: string, now = new Date()) {
  if (id.length > 64) return null;
  const p = await prisma.property.findUnique({
    where: { id },
    select: {
      id: true,
      slug: true,
      title: true,
      summary: true,
      description: true,
      type: true,
      status: true,
      isDemo: true,
      addressLine1: true,
      addressLine2: true,
      locality: true,
      adminArea: true,
      postcode: true,
      countryCode: true,
      latitude: true,
      longitude: true,
      timezone: true,
      bedrooms: true,
      beds: true,
      bathrooms: true,
      maxGuests: true,
      currency: true,
      nightlyPriceCents: true,
      weekendPriceCents: true,
      cleaningFeeCents: true,
      minNights: true,
      maxNights: true,
      checkInTime: true,
      checkOutTime: true,
      smokingAllowed: true,
      petsAllowed: true,
      eventsAllowed: true,
      quietHoursStart: true,
      quietHoursEnd: true,
      houseRules: true,
      cancellationPolicy: true,
      instantBook: true,
      submittedAt: true,
      reviewedAt: true,
      publishedAt: true,
      rejectionReason: true,
      reviewStartedAt: true,
      reviewStartedBy: { select: { name: true } },
      createdAt: true,
      updatedAt: true,
      destination: { select: { name: true } },
      images: { orderBy: { position: "asc" }, select: { id: true, url: true, alt: true } },
      amenities: { select: { amenity: { select: { label: true } } } },
      blockedDates: { where: { endDate: { gt: todayInTimeZone("Australia/Sydney", now) }, startDate: { lt: addDays(todayInTimeZone("Australia/Sydney", now), 180) } }, orderBy: { startDate: "asc" }, take: 20, select: { startDate: true, endDate: true, source: true } },
      compliance: {
        orderBy: { type: "asc" },
        select: { id: true, type: true, status: true, jurisdiction: true, referenceNumber: true, data: true, expiresAt: true, fileKey: true, submittedAt: true, reviewedAt: true, reviewNote: true, updatedAt: true, reviewedBy: { select: { name: true } } },
      },
      host: {
        select: {
          id: true,
          displayName: true,
          hostType: true,
          legalName: true,
          businessName: true,
          abn: true,
          onboardingStatus: true,
          user: { select: { id: true, name: true, email: true, status: true, createdAt: true } },
          _count: { select: { properties: true } },
        },
      },
      _count: { select: { bookings: { where: { status: { in: ["CONFIRMED", "COMPLETED"] } } } } },
    },
  });
  if (!p) return null;

  const [snapshot, history, notes] = await Promise.all([buildSnapshot(p.id), getHistory("Property", p.id), listNotes("Property", p.id)]);
  const today = todayInTimeZone("Australia/Sydney", now);
  const jurisdiction = p.adminArea ? `${p.countryCode}-${p.adminArea}` : null;
  return {
    property: p,
    checklist: snapshot ? evaluateChecklist(snapshot) : null,
    jurisdiction,
    jurisdictionRules: jurisdictionFor(p.countryCode, p.adminArea),
    complianceFlags: listingComplianceFlags(jurisdiction, p.compliance, today),
    history,
    notes,
  };
}
export type AdminProperty = NonNullable<Awaited<ReturnType<typeof getAdminProperty>>>;
