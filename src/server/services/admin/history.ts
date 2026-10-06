import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { ADMIN_PAGE_SIZE } from "@/lib/admin/query";
import { prisma } from "@/server/db";
import { cleanText, FORBIDDEN, fail, ok, permitted, type AdminActor, type AdminResult } from "./common";

/**
 * Audit history and internal admin notes. Admin-only.
 *
 * AdminAction (admin decisions) and AuditLog (host/customer activity) are append-only: no code
 * path updates or deletes them, and a database trigger rejects UPDATEs. There is deliberately no
 * edit or delete feature for either, or for notes.
 */
export interface HistoryEntry {
  id: string;
  source: "admin" | "user";
  action: string;
  actorName: string;
  actorId: string;
  reason: string | null;
  metadata: Prisma.JsonValue;
  createdAt: Date;
}

/** Combined, newest-first history for one record (bounded). */
export async function getHistory(targetType: string, targetId: string, take = 50): Promise<HistoryEntry[]> {
  const [admin, user] = await Promise.all([
    prisma.adminAction.findMany({ where: { targetType, targetId }, orderBy: { createdAt: "desc" }, take, include: { admin: { select: { name: true } } } }),
    prisma.auditLog.findMany({ where: { targetType, targetId }, orderBy: { createdAt: "desc" }, take, include: { actor: { select: { name: true } } } }),
  ]);
  return [
    ...admin.map((a) => ({ id: a.id, source: "admin" as const, action: a.action, actorName: a.admin.name, actorId: a.adminId, reason: a.reason, metadata: a.metadata, createdAt: a.createdAt })),
    ...user.map((a) => ({ id: a.id, source: "user" as const, action: a.action, actorName: a.actor.name, actorId: a.actorId, reason: null, metadata: a.metadata, createdAt: a.createdAt })),
  ]
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, take);
}

// ── Internal notes ────────────────────────────────────────────────────────────

export const NOTE_TARGETS = ["Property", "User", "Booking"] as const;
export type NoteTarget = (typeof NOTE_TARGETS)[number];

export function listNotes(targetType: NoteTarget, targetId: string) {
  return prisma.adminNote.findMany({
    where: { targetType, targetId },
    orderBy: { createdAt: "desc" },
    take: 100,
    select: { id: true, body: true, createdAt: true, author: { select: { name: true } } },
  });
}

async function targetExists(targetType: NoteTarget, targetId: string): Promise<boolean> {
  if (targetId.length > 64) return false;
  switch (targetType) {
    case "Property":
      return (await prisma.property.count({ where: { id: targetId } })) === 1;
    case "User":
      return (await prisma.user.count({ where: { id: targetId } })) === 1;
    case "Booking":
      return (await prisma.booking.count({ where: { id: targetId } })) === 1;
  }
}

export async function addAdminNote(actor: AdminActor, targetType: string, targetId: string, rawBody: unknown): Promise<AdminResult> {
  if (!permitted(actor, "admin:notes:manage")) return FORBIDDEN();
  if (!(NOTE_TARGETS as readonly string[]).includes(targetType)) return fail("invalid", "Notes can't be added to that record.");
  const body = cleanText(rawBody, 4000);
  if (body.length < 2) return fail("invalid", "Write a note first.");
  if (!(await targetExists(targetType as NoteTarget, targetId))) return fail("not_found", "That record no longer exists.");
  await prisma.adminNote.create({ data: { authorId: actor.id, targetType, targetId, body } });
  return ok(undefined);
}

// ── Audit log browser ─────────────────────────────────────────────────────────

export const AUDIT_SOURCES = ["admin", "user"] as const;
export type AuditSource = (typeof AUDIT_SOURCES)[number];

export async function listAuditEntries({ source, action, targetType, targetId, actorId, page }: { source: AuditSource; action?: string; targetType?: string; targetId?: string; actorId?: string; page: number }) {
  const skip = (page - 1) * ADMIN_PAGE_SIZE;
  if (source === "admin") {
    const where: Prisma.AdminActionWhereInput = {
      ...(action ? { action: { startsWith: action } } : {}),
      ...(targetType ? { targetType } : {}),
      ...(targetId ? { targetId } : {}),
      ...(actorId ? { adminId: actorId } : {}),
    };
    const [total, rows] = await Promise.all([
      prisma.adminAction.count({ where }),
      prisma.adminAction.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip, take: ADMIN_PAGE_SIZE, include: { admin: { select: { name: true } } } }),
    ]);
    return { total, rows: rows.map((r) => ({ id: r.id, action: r.action, actorName: r.admin.name, actorId: r.adminId, targetType: r.targetType, targetId: r.targetId, reason: r.reason, metadata: r.metadata, createdAt: r.createdAt })) };
  }
  const where: Prisma.AuditLogWhereInput = {
    ...(action ? { action: { startsWith: action } } : {}),
    ...(targetType ? { targetType } : {}),
    ...(targetId ? { targetId } : {}),
    ...(actorId ? { actorId } : {}),
  };
  const [total, rows] = await Promise.all([
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip, take: ADMIN_PAGE_SIZE, include: { actor: { select: { name: true } } } }),
  ]);
  return { total, rows: rows.map((r) => ({ id: r.id, action: r.action, actorName: r.actor.name, actorId: r.actorId, targetType: r.targetType, targetId: r.targetId, reason: null, metadata: r.metadata, createdAt: r.createdAt })) };
}
