import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { complianceTransition, documentFlags, EXPIRING_SOON_DAYS, type ComplianceDecision } from "@/lib/admin/compliance";
import { ADMIN_PAGE_SIZE } from "@/lib/admin/query";
import { addDays, todayInTimeZone } from "@/lib/dates";
import { prisma } from "@/server/db";
import { track } from "@/server/providers/analytics";
import { cleanText, FORBIDDEN, fail, MIN_REASON, ok, permitted, recordAdminAction, STALE, type AdminActor, type AdminResult } from "./common";
import { ADMIN_TIMEZONE } from "@/lib/admin/ranges";

/**
 * Compliance review queue. An "approve" here records that an admin REVIEWED the host's declared
 * information — Roavela does not verify registrations with government registers and never claims
 * a listing is legally compliant. `reviewNote` is host-facing; internal notes go in AdminNote.
 */
export const COMPLIANCE_FILTERS = ["pending", "under_review", "reviewed", "rejected", "expired", "expiring", "all"] as const;
export type ComplianceFilter = (typeof COMPLIANCE_FILTERS)[number];
export const COMPLIANCE_FILTER_LABELS: Record<ComplianceFilter, string> = {
  pending: "Awaiting review",
  under_review: "Under review",
  reviewed: "Reviewed",
  rejected: "Needs correction",
  expired: "Expired",
  expiring: `Expiring in ${EXPIRING_SOON_DAYS} days`,
  all: "All",
};

function filterWhere(filter: ComplianceFilter, today: Date): Prisma.ComplianceDocumentWhereInput {
  switch (filter) {
    case "pending":
      return { status: "SUBMITTED" };
    case "under_review":
      return { status: "UNDER_REVIEW" };
    case "reviewed":
      return { status: "APPROVED" };
    case "rejected":
      return { status: "REJECTED" };
    // Expired = marked expired, OR a recorded expiry date that has passed (whatever the status).
    case "expired":
      return { OR: [{ status: "EXPIRED" }, { expiresAt: { lt: today } }] };
    case "expiring":
      return { expiresAt: { gte: today, lte: addDays(today, EXPIRING_SOON_DAYS) }, status: { not: "EXPIRED" } };
    case "all":
      return {};
  }
}

export async function listComplianceQueue({ filter, q, page }: { filter: ComplianceFilter; q?: string; page: number }, now = new Date()) {
  const today = todayInTimeZone(ADMIN_TIMEZONE, now);
  const where: Prisma.ComplianceDocumentWhereInput = {
    AND: [
      filterWhere(filter, today),
      // Only listing-level records are queued (host-level records have no listing to review).
      { propertyId: { not: null } },
      q
        ? {
            OR: [
              { referenceNumber: { contains: q.toUpperCase() } },
              { property: { title: { contains: q, mode: "insensitive" } } },
              { host: { displayName: { contains: q, mode: "insensitive" } } },
              { jurisdiction: q.toUpperCase() },
            ],
          }
        : {},
    ],
  };
  const [total, rows] = await Promise.all([
    prisma.complianceDocument.count({ where }),
    prisma.complianceDocument.findMany({
      where,
      orderBy: filter === "expiring" ? [{ expiresAt: "asc" }, { id: "asc" }] : [{ submittedAt: "asc" }, { id: "asc" }],
      skip: (page - 1) * ADMIN_PAGE_SIZE,
      take: ADMIN_PAGE_SIZE,
      select: {
        id: true,
        type: true,
        status: true,
        jurisdiction: true,
        referenceNumber: true,
        expiresAt: true,
        data: true,
        fileKey: true,
        submittedAt: true,
        property: { select: { id: true, title: true, status: true } },
        host: { select: { displayName: true } },
      },
    }),
  ]);
  return {
    total,
    rows: rows.map(({ fileKey, data, ...r }) => ({ ...r, hasFile: Boolean(fileKey), flags: documentFlags({ ...r, data }, today) })),
  };
}

export interface ComplianceReviewInput {
  documentId: string;
  decision: ComplianceDecision;
  /** Host-facing note. Required to reject. */
  note?: unknown;
  expectedUpdatedAt: Date | null;
}

export async function reviewComplianceDocument(actor: AdminActor, input: ComplianceReviewInput): Promise<AdminResult<{ status: string }>> {
  if (!permitted(actor, "admin:compliance:review")) return FORBIDDEN();
  const note = cleanText(input.note, 1000);
  if (input.decision === "reject" && note.length < MIN_REASON) return fail("invalid", "Tell the host what needs correcting (at least 5 characters).");

  const doc = await prisma.complianceDocument.findUnique({ where: { id: input.documentId }, select: { id: true, status: true, type: true, propertyId: true, updatedAt: true, expiresAt: true } });
  if (!doc) return fail("not_found", "Compliance record not found.");
  if (!input.expectedUpdatedAt || doc.updatedAt.getTime() !== input.expectedUpdatedAt.getTime()) return STALE("compliance record");
  const to = complianceTransition(input.decision, doc.status);
  if (!to) return fail("invalid_transition", "That decision isn't available for this record's current status.");
  if (input.decision === "expire" && !(doc.expiresAt && doc.expiresAt < todayInTimeZone(ADMIN_TIMEZONE))) {
    return fail("invalid", "Only records whose recorded expiry date has passed can be marked expired.");
  }

  const now = new Date();
  const done = await prisma.$transaction(async (tx) => {
    const updated = await tx.complianceDocument.updateMany({
      where: { id: doc.id, status: doc.status, updatedAt: doc.updatedAt },
      data: {
        status: to,
        ...(input.decision === "start" ? {} : { reviewedAt: now, reviewedById: actor.id, reviewNote: note || null }),
      },
    });
    if (updated.count !== 1) return false;
    await recordAdminAction(tx, {
      adminId: actor.id,
      action: `compliance.${input.decision === "approve" ? "reviewed" : input.decision === "start" ? "review_started" : input.decision === "reject" ? "rejected" : "expired"}`,
      targetType: "Property",
      targetId: doc.propertyId ?? doc.id,
      reason: note || null,
      metadata: { documentId: doc.id, type: doc.type, from: doc.status, to },
    });
    return true;
  });
  if (!done) return STALE("compliance record");
  track({ name: "compliance_reviewed", properties: { documentId: doc.id, decision: input.decision } });
  return ok({ status: to });
}

/** Admin read of a compliance document's file is audited (who opened which record, never contents). */
export async function recordDocumentAccess(actor: AdminActor, documentId: string) {
  const doc = await prisma.complianceDocument.findUnique({ where: { id: documentId }, select: { propertyId: true, type: true } });
  if (!doc) return;
  await prisma.adminAction.create({ data: { adminId: actor.id, action: "compliance.document_viewed", targetType: "Property", targetId: doc.propertyId ?? documentId, metadata: { documentId, type: doc.type } } });
}
