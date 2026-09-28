import "server-only";
import { prisma } from "@/server/db";
import { demoListingsVisible } from "@/server/env";
import { publicVisibilityConditions } from "./search-query";

export type SetFavouriteResult = "saved" | "removed" | "not_found";

/**
 * Idempotent save/remove. The caller supplies the *desired* state, so repeated or concurrent
 * requests converge instead of flipping back and forth. Duplicates are impossible: the database
 * primary key is (userId, propertyId), and saving uses an upsert.
 *
 * `userId` must come from the server-side session — never from the client.
 */
export async function setFavourite(userId: string, propertyId: string, saved: boolean): Promise<SetFavouriteResult> {
  if (!saved) {
    // Removing is always allowed, even if the listing has since been unpublished.
    await prisma.favourite.deleteMany({ where: { userId, propertyId } });
    return "removed";
  }
  const visible = await prisma.property.count({
    where: { AND: [{ id: propertyId }, ...publicVisibilityConditions(demoListingsVisible())] },
  });
  if (!visible) return "not_found";
  await prisma.favourite.upsert({
    where: { userId_propertyId: { userId, propertyId } },
    create: { userId, propertyId },
    update: {},
  });
  return "saved";
}

/** One page of a user's saved property ids, newest first (database-level pagination). */
export async function listFavouritePage(userId: string, page: number, pageSize: number) {
  const [total, rows] = await Promise.all([
    prisma.favourite.count({ where: { userId } }),
    prisma.favourite.findMany({
      where: { userId },
      orderBy: [{ createdAt: "desc" }, { propertyId: "asc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: { propertyId: true },
    }),
  ]);
  return { total, totalPages: Math.max(1, Math.ceil(total / pageSize)), propertyIds: rows.map((r) => r.propertyId) };
}
