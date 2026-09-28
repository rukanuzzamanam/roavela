"use server";

import { z } from "zod";
import { authorize, AuthorizationError } from "@/server/auth/guards";
import { prisma } from "@/server/db";
import { track } from "@/server/providers/analytics";
import { getRateLimiter, RATE_LIMITS } from "@/server/rate-limit";

export type FavouriteResult = { ok: true; saved: boolean } | { ok: false; error: "unauthenticated" | "rate_limited" | "not_found" };

const inputSchema = z.object({ propertyId: z.string().min(1).max(64) });

export async function toggleFavourite(input: { propertyId: string }): Promise<FavouriteResult> {
  let user;
  try {
    user = await authorize("favourite:manage");
  } catch (e) {
    if (e instanceof AuthorizationError) return { ok: false, error: "unauthenticated" };
    throw e;
  }

  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "not_found" };
  const { propertyId } = parsed.data;

  const limit = await getRateLimiter().consume(`fav:${user.id}`, RATE_LIMITS.favourite);
  if (!limit.success) return { ok: false, error: "rate_limited" };

  // Only publicly listed properties can be saved.
  const exists = await prisma.property.count({ where: { id: propertyId, status: "PUBLISHED" } });
  if (!exists) return { ok: false, error: "not_found" };

  const key = { userId_propertyId: { userId: user.id, propertyId } };
  const existing = await prisma.favourite.findUnique({ where: key, select: { userId: true } });
  if (existing) {
    await prisma.favourite.delete({ where: key });
  } else {
    // upsert tolerates a concurrent double-click creating the row first.
    await prisma.favourite.upsert({ where: key, create: { userId: user.id, propertyId }, update: {} });
  }

  track({ name: "property_saved", properties: { propertyId, saved: !existing }, userId: user.id });
  return { ok: true, saved: !existing };
}
