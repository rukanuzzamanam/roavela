import "server-only";
import { forbidden, redirect } from "next/navigation";
import { can, type Permission } from "@/lib/permissions";
import { getCurrentUser, type SessionUser } from "./session";

/**
 * Server-side authorisation guards. Use these in every protected page, layout, Server Action and
 * Route Handler — layouts alone are not a security boundary.
 */

export async function requireUser(returnTo?: string): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) {
    const next = returnTo ? `?next=${encodeURIComponent(returnTo)}` : "";
    redirect(`/login${next}`);
  }
  return user;
}

export async function requirePermission(permission: Permission, returnTo?: string): Promise<SessionUser> {
  const user = await requireUser(returnTo);
  if (!can(user.role, permission)) forbidden();
  return user;
}

export class AuthorizationError extends Error {
  constructor(message = "You do not have permission to do that.") {
    super(message);
    this.name = "AuthorizationError";
  }
}

/** For Server Actions that return a result instead of redirecting. */
export async function authorize(permission: Permission): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user || !can(user.role, permission)) throw new AuthorizationError();
  return user;
}
