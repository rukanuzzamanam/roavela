import "server-only";
import type { PropertyStatus } from "@/generated/prisma/enums";
import { canHostEdit, REVIEWED_STATUSES } from "@/lib/listing-lifecycle";
import { audit } from "@/server/audit";
import { prisma } from "@/server/db";

/**
 * Ownership is enforced in the database query itself: a property is only ever loaded through
 * `ownedWhere(userId, propertyId)`, so another host's id behaves exactly like a missing id
 * (we answer "not found" rather than revealing that it exists).
 *
 * `userId` MUST come from the server-side session, never from the client.
 */
export function ownedWhere(userId: string, propertyId: string) {
  return { id: propertyId, host: { userId } };
}

export type HostError =
  | { ok: false; error: "not_found"; message: string }
  | { ok: false; error: "not_editable"; message: string }
  | { ok: false; error: "invalid"; message: string; fieldErrors?: Record<string, string> }
  | { ok: false; error: "conflict"; message: string }
  | { ok: false; error: "limit"; message: string };

export type HostResult<T = undefined> = { ok: true; value: T } | HostError;

export const notFound = (): HostError => ({ ok: false, error: "not_found", message: "We couldn't find that listing in your account." });
export const notEditable = (status: PropertyStatus): HostError => ({
  ok: false,
  error: "not_editable",
  message:
    status === "PENDING_REVIEW"
      ? "This listing is under review. Withdraw it from review to make changes."
      : "This listing can't be edited in its current state.",
});

export async function loadOwnedProperty(userId: string, propertyId: string) {
  return prisma.property.findFirst({
    where: ownedWhere(userId, propertyId),
    select: { id: true, hostId: true, status: true, adminArea: true, countryCode: true, completedSections: true, slug: true, title: true },
  });
}

/** Load a property for editing: owned by the user AND in an editable status. */
export async function loadEditableProperty(userId: string, propertyId: string): Promise<HostResult<NonNullable<Awaited<ReturnType<typeof loadOwnedProperty>>>>> {
  const p = await loadOwnedProperty(userId, propertyId);
  if (!p) return notFound();
  if (!canHostEdit(p.status)) return notEditable(p.status);
  return { ok: true, value: p };
}

export function withSection(completed: string[], section: string): string[] {
  return completed.includes(section) ? completed : [...completed, section];
}

/** Edits to an already-reviewed listing are audit-logged so admins can see what changed. */
export async function noteEdit(userId: string, property: { id: string; status: PropertyStatus }, section: string) {
  if (REVIEWED_STATUSES.includes(property.status)) {
    await audit(userId, "property.edited_after_review", "Property", property.id, { section });
  }
}
