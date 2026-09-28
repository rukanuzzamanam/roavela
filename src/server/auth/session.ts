import "server-only";
import { cookies } from "next/headers";
import { cache } from "react";
import type { Role } from "@/generated/prisma/enums";
import { prisma } from "@/server/db";
import { env } from "@/server/env";
import { generateToken, hashToken } from "./tokens";

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function cookieName() {
  // The __Host- prefix makes browsers enforce Secure, Path=/ and no Domain attribute.
  return env().NODE_ENV === "production" ? "__Host-roavela_session" : "roavela_session";
}

/** The authenticated user, as re-read from the database on every request. */
export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: Role;
}

/** Create a session and set the cookie. Must be called from a Server Action or Route Handler. */
export async function createSession(userId: string, meta: { userAgent?: string | null; ipAddress?: string | null } = {}) {
  const token = generateToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await prisma.session.create({
    data: {
      id: hashToken(token),
      userId,
      expiresAt,
      userAgent: meta.userAgent?.slice(0, 300) ?? null,
      ipAddress: meta.ipAddress?.slice(0, 64) ?? null,
    },
  });
  const store = await cookies();
  store.set(cookieName(), token, {
    httpOnly: true,
    secure: env().NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

/** Resolve the current user from the session cookie. Deduplicated per request. */
export const getCurrentUser = cache(async (): Promise<SessionUser | null> => {
  const store = await cookies();
  const token = store.get(cookieName())?.value;
  if (!token || token.length > 200) return null;

  const session = await prisma.session.findUnique({
    where: { id: hashToken(token) },
    select: {
      expiresAt: true,
      user: { select: { id: true, email: true, name: true, role: true, status: true } },
    },
  });
  if (!session) return null;
  if (session.expiresAt.getTime() <= Date.now()) return null;
  // Suspended accounts lose access immediately, even with a live session.
  if (session.user.status !== "ACTIVE") return null;

  const { id, email, name, role } = session.user;
  return { id, email, name, role };
});

/** Delete the current session and clear the cookie. */
export async function destroySession() {
  const store = await cookies();
  const token = store.get(cookieName())?.value;
  if (token) {
    await prisma.session.deleteMany({ where: { id: hashToken(token) } });
  }
  store.delete(cookieName());
}

/** Revoke every session for a user (e.g. after a password reset or account suspension). */
export async function destroyAllSessionsForUser(userId: string) {
  await prisma.session.deleteMany({ where: { userId } });
}
