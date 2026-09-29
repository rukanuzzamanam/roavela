import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/server/db";

/**
 * Record a significant non-admin action. Metadata must never contain secrets, tokens, document
 * contents or full addresses. Logging failures never break the user's action.
 */
export async function audit(actorId: string, action: string, targetType: string, targetId: string, metadata?: Prisma.InputJsonValue) {
  try {
    await prisma.auditLog.create({ data: { actorId, action, targetType, targetId, metadata } });
  } catch (e) {
    console.error("[audit] failed to record", action, e instanceof Error ? e.message : "unknown");
  }
}
