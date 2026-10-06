"use server";

import { revalidatePath } from "next/cache";
import { gateAdminAction } from "@/server/auth/admin-guard";
import { parseVersion } from "@/server/services/admin/common";
import { reviewComplianceDocument } from "@/server/services/admin/compliance";
import { updateDestination } from "@/server/services/admin/destinations";
import { addAdminNote } from "@/server/services/admin/history";
import { moderateReview } from "@/server/services/admin/reviews";
import { REVIEW_CATEGORIES, reviewListing, startListingReview, type ReviewCategory, type ReviewDecision, type ReviewError } from "@/server/services/listing-review";
import { adminPath, denied, field, idField, toFormState, type AdminFormState } from "./admin-form";

/**
 * Admin Server Actions for listings, compliance, reviews, destinations and notes.
 * Each action: (1) authorises the capability server-side from the session and rate-limits,
 * (2) reads only identifiers and the admin's inputs, (3) calls a service that re-checks the
 * capability, the current state, the allowed transition and the record version. Next.js verifies
 * the Origin of every Server Action request (CSRF protection); they are POST-only.
 */

const REVIEW_ERRORS: Record<ReviewError, string> = {
  forbidden: "You don't have permission to do that.",
  not_found: "That listing no longer exists.",
  invalid_transition: "That decision isn't available for this listing's current status.",
  reason_required: "Write a message for the host (at least 5 characters).",
  stale: "This listing was already updated by another administrator. Reload the page to see the latest version.",
  host_inactive: "The host's account is suspended. Reactivate the account before publishing or reinstating listings.",
};

const DECISIONS: readonly ReviewDecision[] = ["approve", "request_changes", "reject", "suspend", "reinstate"];
const DONE: Record<ReviewDecision, string> = {
  approve: "Listing approved and published.",
  request_changes: "Changes requested — the host has been notified.",
  reject: "Listing rejected — the host has been notified.",
  suspend: "Listing suspended.",
  reinstate: "Listing reinstated as paused. The host can resume it.",
};

export async function decideListingAction(_prev: AdminFormState, fd: FormData): Promise<AdminFormState> {
  const gate = await gateAdminAction("admin:properties:moderate");
  if (!gate.ok) return denied(gate.error);
  const propertyId = idField(fd, "propertyId");
  const decision = field(fd, "decision") as ReviewDecision;
  if (!propertyId || !DECISIONS.includes(decision)) return denied("Invalid request.");
  if (decision === "approve" && field(fd, "complianceReviewed") !== "on") {
    return { ok: false, message: "Confirm you have reviewed the listing and its compliance information before approving.", at: Date.now() };
  }
  const category = field(fd, "category");
  const result = await reviewListing(gate.admin, propertyId, decision, {
    reason: field(fd, "reason"),
    category: category in REVIEW_CATEGORIES ? (category as ReviewCategory) : undefined,
    internalNote: field(fd, "internalNote"),
    expectedUpdatedAt: parseVersion(field(fd, "version")),
  });
  if (!result.ok) return { ok: false, message: REVIEW_ERRORS[result.error], at: Date.now() };
  revalidatePath(`/admin/properties/${propertyId}`);
  return { ok: true, message: DONE[decision], at: Date.now() };
}

export async function startReviewAction(_prev: AdminFormState, fd: FormData): Promise<AdminFormState> {
  const gate = await gateAdminAction("admin:properties:moderate");
  if (!gate.ok) return denied(gate.error);
  const propertyId = idField(fd, "propertyId");
  if (!propertyId) return denied("Invalid request.");
  const result = await startListingReview(gate.admin, propertyId);
  if (!result.ok) return { ok: false, message: result.error === "stale" ? "Another administrator is already reviewing this listing." : REVIEW_ERRORS[result.error], at: Date.now() };
  revalidatePath(`/admin/properties/${propertyId}`);
  return { ok: true, message: "Review started.", at: Date.now() };
}

export async function reviewComplianceAction(_prev: AdminFormState, fd: FormData): Promise<AdminFormState> {
  const gate = await gateAdminAction("admin:compliance:review");
  if (!gate.ok) return denied(gate.error);
  const documentId = idField(fd, "documentId");
  const decision = field(fd, "decision");
  if (!documentId || !["start", "approve", "reject", "expire"].includes(decision)) return denied("Invalid request.");
  const result = await reviewComplianceDocument(gate.admin, {
    documentId,
    decision: decision as "start" | "approve" | "reject" | "expire",
    note: field(fd, "note"),
    expectedUpdatedAt: parseVersion(field(fd, "version")),
  });
  const path = adminPath(field(fd, "path"));
  if (result.ok && path) revalidatePath(path);
  return toFormState(result, decision === "approve" ? "Marked as compliance information reviewed." : decision === "reject" ? "Returned to the host for correction." : decision === "expire" ? "Marked as expired." : "Review started.");
}

export async function addNoteAction(_prev: AdminFormState, fd: FormData): Promise<AdminFormState> {
  const gate = await gateAdminAction("admin:notes:manage");
  if (!gate.ok) return denied(gate.error);
  const targetId = idField(fd, "targetId");
  if (!targetId) return denied("Invalid request.");
  const result = await addAdminNote(gate.admin, field(fd, "targetType"), targetId, field(fd, "body"));
  const path = adminPath(field(fd, "path"));
  if (result.ok && path) revalidatePath(path);
  return toFormState(result, "Internal note added.");
}

export async function moderateReviewAction(_prev: AdminFormState, fd: FormData): Promise<AdminFormState> {
  const gate = await gateAdminAction("admin:reviews:moderate");
  if (!gate.ok) return denied(gate.error);
  const reviewId = idField(fd, "reviewId");
  if (!reviewId) return denied("Invalid request.");
  const result = await moderateReview(gate.admin, { reviewId, decision: field(fd, "decision"), reason: field(fd, "reason"), expectedUpdatedAt: parseVersion(field(fd, "version")) });
  if (result.ok) revalidatePath("/admin/reviews");
  return toFormState(result, "Moderation decision recorded.");
}

const DESTINATION_FIELDS = ["name", "adminArea", "tagline", "summary", "heroImageUrl", "seoTitle", "seoDescription", "latitude", "longitude", "isPublished"] as const;

export async function updateDestinationAction(_prev: AdminFormState, fd: FormData): Promise<AdminFormState> {
  const gate = await gateAdminAction("admin:destinations:manage");
  if (!gate.ok) return denied(gate.error);
  const id = idField(fd, "destinationId");
  if (!id) return denied("Invalid request.");
  const values = Object.fromEntries(DESTINATION_FIELDS.map((k) => [k, field(fd, k)]));
  const result = await updateDestination(gate.admin, { id, values, expectedUpdatedAt: parseVersion(field(fd, "version")) });
  if (result.ok) revalidatePath(`/admin/destinations/${id}`);
  return toFormState(result, "Destination saved.");
}
