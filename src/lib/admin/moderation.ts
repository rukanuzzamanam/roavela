import type { ReviewStatus } from "@/generated/prisma/enums";

/**
 * Review moderation decisions. They change a review's visibility only — never its text, ratings or
 * author — and there is no decision that creates a review.
 */
export type ModerationDecision = "keep" | "hide" | "remove" | "restore";

const MODERATION: Record<ModerationDecision, { from: readonly ReviewStatus[]; to: ReviewStatus }> = {
  keep: { from: ["FLAGGED"], to: "PUBLISHED" },
  hide: { from: ["PUBLISHED", "FLAGGED"], to: "HIDDEN" },
  remove: { from: ["PUBLISHED", "FLAGGED", "HIDDEN"], to: "REMOVED" },
  restore: { from: ["HIDDEN"], to: "PUBLISHED" },
};

export function isModerationDecision(value: unknown): value is ModerationDecision {
  return typeof value === "string" && Object.hasOwn(MODERATION, value);
}

export function moderationTransition(decision: ModerationDecision, from: ReviewStatus): ReviewStatus | null {
  return MODERATION[decision].from.includes(from) ? MODERATION[decision].to : null;
}
