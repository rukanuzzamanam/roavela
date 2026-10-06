import "server-only";
import type { Role } from "@/generated/prisma/enums";
import { transition, type ListingIntent } from "@/lib/listing-lifecycle";
import { can } from "@/lib/permissions";
import { prisma } from "@/server/db";
import { listingApprovedEmail, listingChangesRequestedEmail, listingRejectedEmail, listingSuspendedEmail, sendAdminEmail } from "@/server/emails/admin-emails";
import { track } from "@/server/providers/analytics";

/**
 * Admin listing review. Only users with the `admin:properties:moderate` permission — checked here,
 * on the server — can approve, request changes, reject, suspend or reinstate. A host can never
 * approve their own listing: HOST lacks the permission, and the lifecycle rejects admin intents
 * from host actors. Every decision records the reviewer, timestamp and reason in AdminAction, in
 * the same transaction as the status change.
 *
 * Status vocabulary (reused from Phase 3, no duplicates): PENDING_REVIEW is "submitted"; it is
 * "under review" once an admin opens the review (reviewStartedAt). Approval publishes the listing
 * directly — "approved" ≡ PUBLISHED — so there is no separate approved-but-hidden state to leak.
 */
export type ReviewDecision = Extract<ListingIntent, "approve" | "request_changes" | "reject" | "suspend" | "reinstate">;

export const REVIEW_CATEGORIES = {
  photos: "Photos",
  description: "Description & details",
  pricing: "Pricing & fees",
  location: "Location & address",
  compliance: "Compliance information",
  house_rules: "House rules & policies",
  accuracy: "Listing accuracy",
  policy: "Marketplace policy",
  other: "Other",
} as const;
export type ReviewCategory = keyof typeof REVIEW_CATEGORIES;

export interface ReviewOptions {
  /** Host-facing message (shown on the host's listing page and emailed). Required except to approve/reinstate. */
  reason?: string;
  category?: ReviewCategory;
  /** INTERNAL note for other admins. Never shown to the host. */
  internalNote?: string;
  /** Optimistic concurrency: the listing's updatedAt when the admin's page was rendered. */
  expectedUpdatedAt?: Date | null;
}

export type ReviewError = "forbidden" | "not_found" | "invalid_transition" | "reason_required" | "stale" | "host_inactive";
export type ReviewResult = { ok: true; status: string } | { ok: false; error: ReviewError };

const NEEDS_REASON: readonly ReviewDecision[] = ["request_changes", "reject", "suspend"];

export async function reviewListing(actor: { id: string; role: Role }, propertyId: string, decision: ReviewDecision, reasonOrOptions?: string | ReviewOptions): Promise<ReviewResult> {
  if (!can(actor.role, "admin:properties:moderate")) return { ok: false, error: "forbidden" };
  const opts: ReviewOptions = typeof reasonOrOptions === "string" ? { reason: reasonOrOptions } : (reasonOrOptions ?? {});
  const trimmed = opts.reason?.trim().slice(0, 2000) ?? "";
  if (NEEDS_REASON.includes(decision) && trimmed.length < 5) return { ok: false, error: "reason_required" };
  const internalNote = opts.internalNote?.trim().slice(0, 4000) ?? "";
  const category = opts.category && opts.category in REVIEW_CATEGORIES ? opts.category : undefined;

  const property = await prisma.property.findUnique({
    where: { id: propertyId },
    select: { id: true, status: true, title: true, updatedAt: true, host: { select: { user: { select: { email: true, status: true } } } } },
  });
  if (!property) return { ok: false, error: "not_found" };
  if (opts.expectedUpdatedAt && property.updatedAt.getTime() !== opts.expectedUpdatedAt.getTime()) return { ok: false, error: "stale" };

  const t = transition(decision, "admin", property.status);
  if (!t.ok) return { ok: false, error: "invalid_transition" };
  // A suspended host's listings can't be published or brought back (reactivate the account first).
  if ((decision === "approve" || decision === "reinstate") && property.host.user.status !== "ACTIVE") return { ok: false, error: "host_inactive" };

  // Host-facing feedback, prefixed with its category so the host knows what to fix.
  const hostMessage = category && trimmed ? `${REVIEW_CATEGORIES[category]}: ${trimmed}` : trimmed;
  const now = new Date();
  const result = await prisma.$transaction(async (tx) => {
    const updated = await tx.property.updateMany({
      // Conditional on the status (and version, when given) we validated: a concurrent decision wins once.
      where: { id: property.id, status: property.status, ...(opts.expectedUpdatedAt ? { updatedAt: opts.expectedUpdatedAt } : {}) },
      data: {
        status: t.to,
        reviewedAt: now,
        ...(decision === "approve" ? { publishedAt: now, rejectionReason: null } : {}),
        ...(decision === "request_changes" || decision === "reject" ? { rejectionReason: hostMessage } : {}),
        ...(decision === "approve" || decision === "request_changes" || decision === "reject" ? { reviewStartedAt: null, reviewStartedById: null } : {}),
      },
    });
    if (updated.count !== 1) return false;
    await tx.adminAction.create({
      data: {
        adminId: actor.id,
        action: `property.${decision}`,
        targetType: "Property",
        targetId: property.id,
        reason: trimmed || null,
        metadata: { from: property.status, to: t.to, ...(category ? { category } : {}) },
      },
    });
    if (internalNote) await tx.adminNote.create({ data: { authorId: actor.id, targetType: "Property", targetId: property.id, body: internalNote } });
    return true;
  });
  if (!result) {
    const current = await prisma.property.findUnique({ where: { id: property.id }, select: { status: true } });
    return { ok: false, error: current?.status === property.status ? "stale" : "invalid_transition" };
  }

  // After commit: notify the host (never blocks the decision) and record a PII-free event.
  const to = property.host.user.email;
  if (decision === "approve") {
    track({ name: "property_approved", properties: { propertyId } });
    await sendAdminEmail("listing_approved", propertyId, listingApprovedEmail(to, property.title, propertyId));
  } else if (decision === "request_changes") {
    track({ name: "property_changes_requested", properties: { propertyId, category: category ?? "other" } });
    await sendAdminEmail("listing_changes_requested", propertyId, listingChangesRequestedEmail(to, property.title, propertyId, hostMessage));
  } else if (decision === "reject") {
    track({ name: "property_rejected", properties: { propertyId, category: category ?? "other" } });
    await sendAdminEmail("listing_rejected", propertyId, listingRejectedEmail(to, property.title, propertyId, hostMessage));
  } else if (decision === "suspend") {
    track({ name: "property_suspended", properties: { propertyId } });
    await sendAdminEmail("listing_suspended", propertyId, listingSuspendedEmail(to, property.title, trimmed));
  }
  return { ok: true, status: t.to };
}

/** Mark a submitted listing as "under review" by this admin. Idempotent for the same admin. */
export async function startListingReview(actor: { id: string; role: Role }, propertyId: string): Promise<ReviewResult> {
  if (!can(actor.role, "admin:properties:moderate")) return { ok: false, error: "forbidden" };
  const now = new Date();
  const started = await prisma.$transaction(async (tx) => {
    const updated = await tx.property.updateMany({
      where: { id: propertyId, status: "PENDING_REVIEW", reviewStartedAt: null },
      data: { reviewStartedAt: now, reviewStartedById: actor.id },
    });
    if (updated.count !== 1) return false;
    await tx.adminAction.create({ data: { adminId: actor.id, action: "property.review_started", targetType: "Property", targetId: propertyId, metadata: { status: "PENDING_REVIEW" } } });
    return true;
  });
  if (!started) {
    const p = await prisma.property.findUnique({ where: { id: propertyId }, select: { status: true, reviewStartedById: true } });
    if (!p) return { ok: false, error: "not_found" };
    if (p.status !== "PENDING_REVIEW") return { ok: false, error: "invalid_transition" };
    return p.reviewStartedById === actor.id ? { ok: true, status: "PENDING_REVIEW" } : { ok: false, error: "stale" };
  }
  track({ name: "property_review_started", properties: { propertyId } });
  return { ok: true, status: "PENDING_REVIEW" };
}
