import type { PropertyStatus } from "@/generated/prisma/enums";

/**
 * Listing lifecycle — the single source of truth for which status changes are allowed and by whom.
 *
 *   DRAFT ──submit──▶ PENDING_REVIEW ──approve (admin)──▶ PUBLISHED ◀──resume── PAUSED
 *     ▲                 │    │                                │ pause ──────────▲
 *     └──withdraw───────┘    ├─request changes (admin)─▶ CHANGES_REQUESTED ─resubmit─▶ PENDING_REVIEW
 *                            └─reject (admin)──────────▶ REJECTED
 *   PUBLISHED/PAUSED ──suspend (admin)──▶ SUSPENDED ──reinstate (admin)──▶ PAUSED
 *   DRAFT / CHANGES_REQUESTED / REJECTED / PAUSED ──archive (host)──▶ ARCHIVED
 *
 * Status is NEVER accepted from the client. Every change goes through a named intent below, and
 * hosts have no intent that leads to PUBLISHED except resuming a listing an admin already approved.
 */

export type ListingIntent =
  | "submit"
  | "withdraw"
  | "pause"
  | "resume"
  | "archive"
  | "approve"
  | "request_changes"
  | "reject"
  | "suspend"
  | "reinstate";

export type Actor = "host" | "admin";

const TRANSITIONS: Record<ListingIntent, { actor: Actor; from: readonly PropertyStatus[]; to: PropertyStatus }> = {
  submit: { actor: "host", from: ["DRAFT", "CHANGES_REQUESTED"], to: "PENDING_REVIEW" },
  withdraw: { actor: "host", from: ["PENDING_REVIEW"], to: "DRAFT" },
  pause: { actor: "host", from: ["PUBLISHED"], to: "PAUSED" },
  resume: { actor: "host", from: ["PAUSED"], to: "PUBLISHED" },
  archive: { actor: "host", from: ["DRAFT", "CHANGES_REQUESTED", "REJECTED", "PAUSED"], to: "ARCHIVED" },
  approve: { actor: "admin", from: ["PENDING_REVIEW"], to: "PUBLISHED" },
  request_changes: { actor: "admin", from: ["PENDING_REVIEW"], to: "CHANGES_REQUESTED" },
  reject: { actor: "admin", from: ["PENDING_REVIEW"], to: "REJECTED" },
  suspend: { actor: "admin", from: ["PUBLISHED", "PAUSED"], to: "SUSPENDED" },
  reinstate: { actor: "admin", from: ["SUSPENDED"], to: "PAUSED" },
};

export type TransitionResult = { ok: true; to: PropertyStatus } | { ok: false; reason: "wrong_actor" | "invalid_from_status" };

export function transition(intent: ListingIntent, actor: Actor, from: PropertyStatus): TransitionResult {
  const rule = TRANSITIONS[intent];
  if (rule.actor !== actor) return { ok: false, reason: "wrong_actor" };
  if (!rule.from.includes(from)) return { ok: false, reason: "invalid_from_status" };
  return { ok: true, to: rule.to };
}

export function availableHostIntents(status: PropertyStatus): ListingIntent[] {
  return (Object.keys(TRANSITIONS) as ListingIntent[]).filter((i) => TRANSITIONS[i].actor === "host" && TRANSITIONS[i].from.includes(status));
}

/** Statuses in which the host may edit listing content. PENDING_REVIEW is locked (withdraw to edit). */
export const HOST_EDITABLE_STATUSES: readonly PropertyStatus[] = ["DRAFT", "CHANGES_REQUESTED", "PUBLISHED", "PAUSED"];

/** Edits to these listings happen after an admin approved them and are audit-logged as such. */
export const REVIEWED_STATUSES: readonly PropertyStatus[] = ["PUBLISHED", "PAUSED"];

export function canHostEdit(status: PropertyStatus): boolean {
  return HOST_EDITABLE_STATUSES.includes(status);
}

export const STATUS_LABELS: Record<PropertyStatus, { label: string; tone: "neutral" | "warning" | "success" | "demo" | "accent"; help: string }> = {
  DRAFT: { label: "Draft", tone: "neutral", help: "Only you can see this listing. Complete the checklist and submit it for review." },
  PENDING_REVIEW: { label: "Under review", tone: "warning", help: "Our team is reviewing your listing. It isn't visible to guests yet. Withdraw it if you need to make changes." },
  CHANGES_REQUESTED: { label: "Changes requested", tone: "warning", help: "A reviewer asked for changes. Update the listing and resubmit." },
  PUBLISHED: { label: "Live", tone: "success", help: "Approved and visible to guests in search." },
  PAUSED: { label: "Paused", tone: "neutral", help: "Hidden from search. Resume at any time." },
  REJECTED: { label: "Not approved", tone: "demo", help: "This listing wasn't approved. See the reviewer's notes." },
  SUSPENDED: { label: "Suspended", tone: "demo", help: "Suspended by Roavela. Contact support for details." },
  ARCHIVED: { label: "Archived", tone: "neutral", help: "Archived listings are kept for your records only." },
};
