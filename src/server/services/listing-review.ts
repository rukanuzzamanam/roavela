import "server-only";
import type { Role } from "@/generated/prisma/enums";
import { transition, type ListingIntent } from "@/lib/listing-lifecycle";
import { can } from "@/lib/permissions";
import { prisma } from "@/server/db";

/**
 * Admin review foundation (the review UI arrives with the admin phase).
 *
 * Only users with the `admin:properties:moderate` permission — checked here, on the server — can
 * approve, request changes, reject, suspend or reinstate. A host can never approve their own
 * listing: HOST lacks the permission, and the lifecycle rejects admin intents from host actors.
 * Every decision records the reviewer, timestamp and reason in AdminAction.
 */
export type ReviewDecision = Extract<ListingIntent, "approve" | "request_changes" | "reject" | "suspend" | "reinstate">;

export type ReviewResult = { ok: true; status: string } | { ok: false; error: "forbidden" | "not_found" | "invalid_transition" | "reason_required" };

export async function reviewListing(actor: { id: string; role: Role }, propertyId: string, decision: ReviewDecision, reason?: string): Promise<ReviewResult> {
  if (!can(actor.role, "admin:properties:moderate")) return { ok: false, error: "forbidden" };
  const trimmed = reason?.trim() ?? "";
  if (decision !== "approve" && trimmed.length < 5) return { ok: false, error: "reason_required" };

  const property = await prisma.property.findUnique({ where: { id: propertyId }, select: { id: true, status: true } });
  if (!property) return { ok: false, error: "not_found" };

  const t = transition(decision, "admin", property.status);
  if (!t.ok) return { ok: false, error: "invalid_transition" };

  const now = new Date();
  const result = await prisma.$transaction(async (tx) => {
    const updated = await tx.property.updateMany({
      where: { id: property.id, status: property.status },
      data: {
        status: t.to,
        reviewedAt: now,
        ...(decision === "approve" ? { publishedAt: now, rejectionReason: null } : {}),
        ...(decision === "request_changes" || decision === "reject" ? { rejectionReason: trimmed } : {}),
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
        metadata: { from: property.status, to: t.to },
      },
    });
    return true;
  });
  return result ? { ok: true, status: t.to } : { ok: false, error: "invalid_transition" };
}
