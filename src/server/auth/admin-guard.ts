import "server-only";
import type { AdminPermission } from "@/lib/permissions";
import { getRateLimiter, RATE_LIMITS } from "@/server/rate-limit";
import { authorize, AuthorizationError, requirePermission } from "./guards";
import type { SessionUser } from "./session";

/**
 * The ONLY entry points for admin authorisation. Every admin page, layout, Server Action and route
 * handler calls one of these. The role is always re-read from the database for the current session
 * (suspended accounts have no session user at all) — never taken from a cookie value, form field,
 * URL or request body, and hidden navigation is never relied on.
 */

/** Admin pages: signed-out → login; signed-in without the capability → 403 page. */
export function requireAdmin(permission: AdminPermission = "admin:portal", returnTo = "/admin"): Promise<SessionUser> {
  return requirePermission(permission, returnTo);
}

export type AdminGate = { ok: true; admin: SessionUser } | { ok: false; error: string };

const DENIED = "You don't have permission to do that.";
const LIMITED = "Too many admin actions in a short time. Please wait a moment and try again.";

/**
 * Admin Server Actions: authorise, then rate-limit per admin. Returns an error result instead of
 * throwing so forms can show it. Rate limits only stop runaway automation, not normal work.
 */
export async function gateAdminAction(permission: AdminPermission, limit: keyof typeof RATE_LIMITS = "adminMutation"): Promise<AdminGate> {
  let admin: SessionUser;
  try {
    admin = await authorize(permission);
  } catch (e) {
    if (e instanceof AuthorizationError) return { ok: false, error: DENIED };
    throw e;
  }
  const result = await getRateLimiter().consume(`${limit}:${admin.id}`, RATE_LIMITS[limit]);
  if (!result.success) return { ok: false, error: LIMITED };
  return { ok: true, admin };
}
