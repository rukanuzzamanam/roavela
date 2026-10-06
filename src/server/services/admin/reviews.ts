import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import type { ReviewStatus } from "@/generated/prisma/enums";
import { isModerationDecision, moderationTransition } from "@/lib/admin/moderation";
import { ADMIN_PAGE_SIZE } from "@/lib/admin/query";
import { prisma } from "@/server/db";
import { cleanText, FORBIDDEN, fail, MIN_REASON, ok, permitted, recordAdminAction, STALE, type AdminActor, type AdminResult } from "./common";

/**
 * Review moderation. Admins can KEEP, HIDE, REMOVE (policy violation) or RESTORE a review — they can
 * never edit its text or ratings, and can never create one: reviews only come from the review flow,
 * which requires a COMPLETED booking by the author (one review per booking, enforced by a unique
 * index). The original text is always preserved; moderation reasons are internal.
 */
export const REVIEW_FILTERS = ["flagged", "published", "hidden", "removed", "all"] as const;
export type ReviewFilter = (typeof REVIEW_FILTERS)[number];

export async function listAdminReviews({ filter, q, page }: { filter: ReviewFilter; q?: string; page: number }) {
  const where: Prisma.ReviewWhereInput = {
    ...(filter === "all" ? {} : { status: filter.toUpperCase() as ReviewStatus }),
    ...(q ? { OR: [{ property: { title: { contains: q, mode: "insensitive" } } }, { author: { name: { contains: q, mode: "insensitive" } } }, { body: { contains: q, mode: "insensitive" } }] } : {}),
  };
  const [total, rows] = await Promise.all([
    prisma.review.count({ where }),
    prisma.review.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      skip: (page - 1) * ADMIN_PAGE_SIZE,
      take: ADMIN_PAGE_SIZE,
      select: {
        id: true,
        overallRating: true,
        body: true,
        hostResponse: true,
        status: true,
        isDemo: true,
        createdAt: true,
        updatedAt: true,
        moderatedAt: true,
        moderationReason: true,
        moderatedBy: { select: { name: true } },
        author: { select: { id: true, name: true } },
        property: { select: { id: true, title: true } },
        booking: { select: { reference: true, status: true } },
      },
    }),
  ]);
  return { total, rows };
}

export async function moderateReview(actor: AdminActor, input: { reviewId: string; decision: unknown; reason: unknown; expectedUpdatedAt: Date | null }): Promise<AdminResult<{ status: ReviewStatus }>> {
  if (!permitted(actor, "admin:reviews:moderate")) return FORBIDDEN();
  if (!isModerationDecision(input.decision)) return fail("invalid", "Choose a moderation decision.");
  const decision = input.decision;
  const reason = cleanText(input.reason, 1000);
  if (reason.length < MIN_REASON) return fail("invalid", "Record a reason for this decision (at least 5 characters).");

  const review = await prisma.review.findUnique({ where: { id: input.reviewId }, select: { id: true, status: true, updatedAt: true, propertyId: true } });
  if (!review) return fail("not_found", "Review not found.");
  if (!input.expectedUpdatedAt || review.updatedAt.getTime() !== input.expectedUpdatedAt.getTime()) return STALE("review");
  const to = moderationTransition(decision, review.status);
  if (!to) return fail("invalid_transition", "That decision isn't available for this review's current status.");

  const done = await prisma.$transaction(async (tx) => {
    const updated = await tx.review.updateMany({
      where: { id: review.id, status: review.status, updatedAt: review.updatedAt },
      // Status and moderation metadata only — body, ratings and author are never touched.
      data: { status: to, moderatedAt: new Date(), moderatedById: actor.id, moderationReason: reason },
    });
    if (updated.count !== 1) return false;
    // Public aggregates count PUBLISHED reviews only; recompute from the source rows.
    const agg = await tx.review.aggregate({ where: { propertyId: review.propertyId, status: "PUBLISHED" }, _avg: { overallRating: true }, _count: { _all: true } });
    await tx.property.update({ where: { id: review.propertyId }, data: { reviewCount: agg._count._all, ratingAverage: agg._count._all > 0 ? agg._avg.overallRating : null } });
    await recordAdminAction(tx, { adminId: actor.id, action: `review.${decision}`, targetType: "Review", targetId: review.id, reason, metadata: { from: review.status, to, propertyId: review.propertyId } });
    return true;
  });
  return done ? ok({ status: to }) : STALE("review");
}
