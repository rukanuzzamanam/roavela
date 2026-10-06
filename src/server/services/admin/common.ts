import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import type { Role } from "@/generated/prisma/enums";
import { can, type AdminPermission } from "@/lib/permissions";

/**
 * Shared building blocks for admin services.
 *
 * - Every service re-checks the actor's capability itself (defence in depth: a future caller that
 *   forgets the action-layer gate still can't act).
 * - Every high-impact change and its AdminAction row are written in ONE transaction, so there is
 *   never a change without its audit record (or vice versa).
 * - Optimistic concurrency: forms carry the record's `updatedAt` as a version. Updates are
 *   conditional on it, so a stale page can never overwrite a newer decision.
 */
export interface AdminActor {
  id: string;
  role: Role;
}

export type AdminErrorCode = "forbidden" | "not_found" | "invalid" | "invalid_transition" | "stale" | "provider";
export type AdminResult<T = undefined> = { ok: true; value: T } | { ok: false; code: AdminErrorCode; message: string };

export const fail = (code: AdminErrorCode, message: string): { ok: false; code: AdminErrorCode; message: string } => ({ ok: false, code, message });
export const ok = <T>(value: T): { ok: true; value: T } => ({ ok: true, value });

export const FORBIDDEN = () => fail("forbidden", "You don't have permission to do that.");
export const STALE = (what = "record") => fail("stale", `This ${what} was already updated by another administrator. Reload the page to see the latest version.`);

export function permitted(actor: AdminActor, permission: AdminPermission): boolean {
  return can(actor.role, permission);
}

/** A version token from a form: the ISO timestamp the admin's page was rendered with. */
export function parseVersion(value: unknown): Date | null {
  if (typeof value !== "string" || value.length > 40) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Reason/notes text: trimmed, control characters stripped, bounded. */
export function cleanText(value: unknown, max = 2000): string {
  return typeof value === "string" ? value.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "").trim().slice(0, max) : "";
}

export const MIN_REASON = 5;

/**
 * Record an admin decision inside the caller's transaction. Metadata must contain identifiers,
 * statuses and amounts only — never secrets, card data, document contents or full addresses.
 */
export function recordAdminAction(
  tx: Prisma.TransactionClient,
  entry: { adminId: string; action: string; targetType: string; targetId: string; reason?: string | null; metadata?: Prisma.InputJsonValue },
) {
  return tx.adminAction.create({ data: { ...entry, reason: entry.reason || null } });
}
