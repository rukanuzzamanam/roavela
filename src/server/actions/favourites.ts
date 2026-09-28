"use server";

import { z } from "zod";
import { authorize, AuthorizationError } from "@/server/auth/guards";
import { track } from "@/server/providers/analytics";
import { getRateLimiter, RATE_LIMITS } from "@/server/rate-limit";
import { setFavourite } from "@/server/services/favourites";

export type FavouriteResult = { ok: true; saved: boolean } | { ok: false; error: "unauthenticated" | "rate_limited" | "not_found" | "invalid" };

const inputSchema = z.object({
  propertyId: z.string().min(1).max(64),
  saved: z.boolean(),
});

/**
 * Save or remove a stay for the signed-in user. The user id comes from the session only; any
 * userId the client might send is ignored because it isn't part of the input schema.
 */
export async function setFavouriteAction(input: { propertyId: string; saved: boolean }): Promise<FavouriteResult> {
  let user;
  try {
    user = await authorize("favourite:manage");
  } catch (e) {
    if (e instanceof AuthorizationError) return { ok: false, error: "unauthenticated" };
    throw e;
  }

  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const { propertyId, saved } = parsed.data;

  const limit = await getRateLimiter().consume(`fav:${user.id}`, RATE_LIMITS.favourite);
  if (!limit.success) return { ok: false, error: "rate_limited" };

  const result = await setFavourite(user.id, propertyId, saved);
  if (result === "not_found") return { ok: false, error: "not_found" };

  track({ name: saved ? "property_saved" : "property_unsaved", properties: { propertyId }, userId: user.id });
  return { ok: true, saved };
}
