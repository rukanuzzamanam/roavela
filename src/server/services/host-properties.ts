import "server-only";
import { randomBytes } from "node:crypto";
import type { z } from "zod";
import { AU_STATES } from "@/config/jurisdictions";
import type { ComplianceDocumentType } from "@/generated/prisma/enums";
import { evaluateChecklist, type ListingSnapshot } from "@/lib/listing-checklist";
import { transition, type ListingIntent } from "@/lib/listing-lifecycle";
import type { amenitiesSchema, basicsSchema, detailsSchema, locationSchema, pricingSchema, rulesSchema } from "@/lib/validation/host";
import { audit } from "@/server/audit";
import { prisma } from "@/server/db";
import { loadEditableProperty, loadOwnedProperty, noteEdit, notFound, ownedWhere, withSection, type HostResult } from "./host-access";
import { isHostProfileComplete } from "./host-profile";
import { ACTIVE_BOOKING_STATUSES } from "./search-query";

export const MAX_LISTINGS_PER_HOST = 25;

function slugify(title: string): string {
  const base = title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return `${base || "stay"}-${randomBytes(3).toString("hex")}`;
}

// ── Create ──────────────────────────────────────────────────────────────────

export async function createPropertyDraft(userId: string, input: z.infer<typeof basicsSchema>): Promise<HostResult<{ id: string }>> {
  const host = await prisma.hostProfile.findUnique({ where: { userId }, select: { id: true, _count: { select: { properties: { where: { status: { not: "ARCHIVED" } } } } } } });
  if (!host) return { ok: false, error: "not_found", message: "Create your host profile before adding a property." };
  if (host._count.properties >= MAX_LISTINGS_PER_HOST) {
    return { ok: false, error: "limit", message: `You can have up to ${MAX_LISTINGS_PER_HOST} active listings. Archive one to add another.` };
  }

  const property = await prisma.property.create({
    data: {
      hostId: host.id, // from the session's host profile — never from the client
      slug: slugify(input.title),
      status: "DRAFT",
      title: input.title,
      type: input.type,
      maxGuests: input.maxGuests,
      bedrooms: input.bedrooms,
      beds: input.beds,
      bathrooms: input.bathrooms,
      countryCode: "AU",
      timezone: "Australia/Sydney",
      completedSections: ["basics"],
    },
    select: { id: true },
  });
  await audit(userId, "property.created", "Property", property.id);
  return { ok: true, value: property };
}

// ── Section saves (each verifies ownership + editability) ──────────────────────

async function saveSection<T extends object>(userId: string, propertyId: string, section: string, data: T): Promise<HostResult> {
  const loaded = await loadEditableProperty(userId, propertyId);
  if (!loaded.ok) return loaded;
  const p = loaded.value;
  await prisma.property.update({ where: { id: p.id }, data: { ...data, completedSections: withSection(p.completedSections, section) } });
  await noteEdit(userId, p, section);
  return { ok: true, value: undefined };
}

export function saveBasics(userId: string, propertyId: string, input: z.infer<typeof basicsSchema>) {
  return saveSection(userId, propertyId, "basics", input);
}

export async function saveLocation(userId: string, propertyId: string, input: z.infer<typeof locationSchema>): Promise<HostResult> {
  // The destination must be a real, published place — clients can't attach arbitrary ids.
  const destination = await prisma.destination.findFirst({ where: { id: input.destinationId, isPublished: true }, select: { id: true } });
  if (!destination) return { ok: false, error: "invalid", message: "Choose a destination from the list.", fieldErrors: { destinationId: "Choose a destination from the list" } };
  const timezone = AU_STATES.find((s) => s.code === input.adminArea)?.timezone ?? "Australia/Sydney";
  return saveSection(userId, propertyId, "location", { ...input, timezone });
}

export function saveDetails(userId: string, propertyId: string, input: z.infer<typeof detailsSchema>) {
  return saveSection(userId, propertyId, "details", input);
}

export async function savePricing(userId: string, propertyId: string, input: z.infer<typeof pricingSchema>): Promise<HostResult> {
  return saveSection(userId, propertyId, "pricing", {
    nightlyPriceCents: input.nightlyPrice,
    weekendPriceCents: input.weekendPrice,
    cleaningFeeCents: input.cleaningFee,
    minNights: input.minNights,
    maxNights: input.maxNights,
  });
}

/**
 * Amenity selection replaces the set atomically. Duplicates are impossible: the input is
 * de-duplicated and (propertyId, amenityId) is the table's primary key. "Pet friendly" is driven
 * by the house-rules pets setting so the two can never disagree.
 */
export async function saveAmenities(userId: string, propertyId: string, input: z.infer<typeof amenitiesSchema>): Promise<HostResult> {
  const loaded = await loadEditableProperty(userId, propertyId);
  if (!loaded.ok) return loaded;
  const p = loaded.value;
  const keys = input.amenities.filter((k) => k !== "pet_friendly");
  const rows = await prisma.amenity.findMany({ where: { key: { in: keys } }, select: { id: true } });
  await prisma.$transaction([
    prisma.propertyAmenity.deleteMany({ where: { propertyId: p.id, amenity: { key: { not: "pet_friendly" } } } }),
    prisma.propertyAmenity.createMany({ data: rows.map((a) => ({ propertyId: p.id, amenityId: a.id })), skipDuplicates: true }),
    prisma.property.update({ where: { id: p.id }, data: { completedSections: withSection(p.completedSections, "amenities") } }),
  ]);
  await noteEdit(userId, p, "amenities");
  return { ok: true, value: undefined };
}

export async function saveRules(userId: string, propertyId: string, input: z.infer<typeof rulesSchema>): Promise<HostResult> {
  const loaded = await loadEditableProperty(userId, propertyId);
  if (!loaded.ok) return loaded;
  const p = loaded.value;
  const pet = await prisma.amenity.findUnique({ where: { key: "pet_friendly" }, select: { id: true } });
  await prisma.$transaction([
    prisma.property.update({ where: { id: p.id }, data: { ...input, completedSections: withSection(p.completedSections, "rules") } }),
    ...(pet
      ? input.petsAllowed
        ? [prisma.propertyAmenity.createMany({ data: [{ propertyId: p.id, amenityId: pet.id }], skipDuplicates: true })]
        : [prisma.propertyAmenity.deleteMany({ where: { propertyId: p.id, amenityId: pet.id } })]
      : []),
  ]);
  await noteEdit(userId, p, "rules");
  return { ok: true, value: undefined };
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────

export async function buildSnapshot(propertyId: string): Promise<ListingSnapshot | null> {
  const p = await prisma.property.findUnique({
    where: { id: propertyId },
    select: {
      title: true,
      maxGuests: true,
      bedrooms: true,
      beds: true,
      bathrooms: true,
      summary: true,
      description: true,
      addressLine1: true,
      locality: true,
      adminArea: true,
      postcode: true,
      countryCode: true,
      destinationId: true,
      nightlyPriceCents: true,
      completedSections: true,
      images: { select: { alt: true } },
      _count: { select: { amenities: true } },
      compliance: { select: { type: true, referenceNumber: true, data: true } },
      host: { select: { displayName: true, legalName: true, phone: true } },
    },
  });
  if (!p) return null;
  const compliance: ListingSnapshot["compliance"] = {};
  for (const c of p.compliance) compliance[c.type as ComplianceDocumentType] = { referenceNumber: c.referenceNumber, data: c.data };
  return {
    ...p,
    amenityCount: p._count.amenities,
    photoCount: p.images.length,
    photosMissingAlt: p.images.filter((i) => i.alt.trim() === "").length,
    compliance,
    hostProfileComplete: isHostProfileComplete(p.host),
  };
}

/**
 * Host-initiated status changes. The target status always comes from the lifecycle rules for the
 * named intent — never from the client — and hosts have no intent that approves or publishes a
 * listing that hasn't been approved.
 */
export async function changeListingStatus(
  userId: string,
  propertyId: string,
  intent: Extract<ListingIntent, "submit" | "withdraw" | "pause" | "resume" | "archive">,
): Promise<HostResult<{ status: string }>> {
  const p = await loadOwnedProperty(userId, propertyId);
  if (!p) return notFound();

  const t = transition(intent, "host", p.status);
  if (!t.ok) return { ok: false, error: "conflict", message: "That action isn't available for this listing right now." };

  if (intent === "submit") {
    const snapshot = await buildSnapshot(p.id);
    const checklist = snapshot ? evaluateChecklist(snapshot) : null;
    if (!checklist?.complete) {
      const firstIssue = checklist ? [...checklist.hostIssues, ...checklist.sections.flatMap((s) => s.issues)][0] : undefined;
      return { ok: false, error: "invalid", message: `Complete your listing before submitting${firstIssue ? `: ${firstIssue.toLowerCase()}` : "."}` };
    }
  }

  if (intent === "archive") {
    const upcoming = await prisma.booking.count({
      where: { propertyId: p.id, status: { in: [...ACTIVE_BOOKING_STATUSES] }, checkOut: { gt: new Date() } },
    });
    if (upcoming > 0) return { ok: false, error: "conflict", message: "This listing has upcoming bookings, so it can't be archived yet. Pause it instead." };
  }

  // Conditional update: only succeeds if the status hasn't changed since we read it.
  const updated = await prisma.property.updateMany({
    where: { ...ownedWhere(userId, p.id), status: p.status },
    data: {
      status: t.to,
      ...(intent === "submit" ? { submittedAt: new Date(), rejectionReason: null } : {}),
    },
  });
  if (updated.count !== 1) return { ok: false, error: "conflict", message: "This listing changed in the meantime. Refresh and try again." };

  await audit(userId, `property.${intent === "submit" ? "submitted" : intent === "withdraw" ? "withdrawn" : intent === "pause" ? "paused" : intent === "resume" ? "resumed" : "archived"}`, "Property", p.id, {
    from: p.status,
    to: t.to,
  });
  return { ok: true, value: { status: t.to } };
}

// ── Reads (owner-scoped) ──────────────────────────────────────────────────────

export async function listHostProperties(userId: string) {
  const rows = await prisma.property.findMany({
    where: { host: { userId } },
    orderBy: [{ updatedAt: "desc" }],
    select: {
      id: true,
      slug: true,
      title: true,
      status: true,
      type: true,
      locality: true,
      isDemo: true,
      nightlyPriceCents: true,
      currency: true,
      updatedAt: true,
      rejectionReason: true,
      images: { select: { url: true, alt: true }, orderBy: { position: "asc" }, take: 1 },
    },
  });
  const withProgress = await Promise.all(
    rows.map(async (r) => {
      const snapshot = await buildSnapshot(r.id);
      const checklist = snapshot ? evaluateChecklist(snapshot) : null;
      return { ...r, percent: checklist?.percent ?? 0, readyToSubmit: checklist?.complete ?? false };
    }),
  );
  return withProgress;
}

/** Full private management view of ONE property, including the address. Owner only. */
export async function getManagedProperty(userId: string, propertyId: string) {
  const property = await prisma.property.findFirst({
    where: ownedWhere(userId, propertyId),
    include: {
      images: { orderBy: { position: "asc" } },
      amenities: { select: { amenity: { select: { key: true } } } },
      blockedDates: { where: { endDate: { gt: new Date(Date.now() - 86_400_000) } }, orderBy: { startDate: "asc" } },
      compliance: true,
      destination: { select: { id: true, name: true } },
    },
  });
  if (!property) return null;
  const snapshot = await buildSnapshot(property.id);
  return { property, checklist: evaluateChecklist(snapshot!) };
}

export async function getHostDashboard(userId: string) {
  const [counts, upcoming] = await Promise.all([
    prisma.property.groupBy({ by: ["status"], where: { host: { userId } }, _count: true }),
    prisma.booking.findMany({
      where: { property: { host: { userId } }, status: { in: ["PENDING", "CONFIRMED"] }, checkIn: { gte: new Date(Date.now() - 86_400_000) } },
      orderBy: { checkIn: "asc" },
      take: 5,
      select: { id: true, reference: true, status: true, checkIn: true, checkOut: true, adults: true, children: true, isDemo: true, property: { select: { title: true } } },
    }),
  ]);
  const byStatus = Object.fromEntries(counts.map((c) => [c.status, c._count])) as Partial<Record<string, number>>;
  return { byStatus, total: counts.reduce((n, c) => n + c._count, 0), upcoming };
}
