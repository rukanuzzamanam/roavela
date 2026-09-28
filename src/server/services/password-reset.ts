import "server-only";
import { hashPassword } from "@/server/auth/password";
import { generateToken, hashToken } from "@/server/auth/tokens";
import { prisma } from "@/server/db";
import { env } from "@/server/env";

/**
 * Password reset.
 *
 * - Tokens are 256-bit random values; only their SHA-256 hash is stored.
 * - Each token expires (PASSWORD_RESET_TOKEN_TTL_MINUTES, default 30) and is single-use.
 * - Issuing a new token invalidates any earlier unused ones for that user.
 * - A successful reset revokes every session for the user and deletes their remaining tokens.
 * - Callers must give the same response whether or not an account exists (no enumeration).
 */

export function resetTokenTtlMs(): number {
  return env().PASSWORD_RESET_TOKEN_TTL_MINUTES * 60_000;
}

/** Returns a raw token to email, or null when no eligible account exists. Never show the token in UI. */
export async function issuePasswordReset(email: string, now = new Date()): Promise<{ token: string; userId: string; name: string } | null> {
  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, name: true, status: true, passwordHash: true },
  });
  // Suspended accounts and accounts without a password (e.g. future social login) can't reset.
  if (!user || user.status !== "ACTIVE" || !user.passwordHash) return null;

  const token = generateToken();
  await prisma.$transaction([
    prisma.passwordResetToken.deleteMany({ where: { userId: user.id, usedAt: null } }),
    prisma.passwordResetToken.create({
      data: { userId: user.id, tokenHash: hashToken(token), expiresAt: new Date(now.getTime() + resetTokenTtlMs()) },
    }),
  ]);
  return { token, userId: user.id, name: user.name };
}

export type ResetTokenState = "valid" | "invalid" | "expired" | "used";

export async function inspectResetToken(token: string, now = new Date()): Promise<ResetTokenState> {
  if (!token || token.length > 200) return "invalid";
  const row = await prisma.passwordResetToken.findUnique({
    where: { tokenHash: hashToken(token) },
    select: { expiresAt: true, usedAt: true, user: { select: { status: true } } },
  });
  if (!row || row.user.status !== "ACTIVE") return "invalid";
  if (row.usedAt) return "used";
  if (row.expiresAt <= now) return "expired";
  return "valid";
}

export async function consumePasswordReset(
  token: string,
  newPassword: string,
  now = new Date(),
): Promise<{ ok: true; userId: string } | { ok: false; reason: Exclude<ResetTokenState, "valid"> }> {
  const state = await inspectResetToken(token, now);
  if (state !== "valid") return { ok: false, reason: state };

  const passwordHash = await hashPassword(newPassword);
  const tokenHash = hashToken(token);

  return prisma.$transaction(async (tx) => {
    // Claim the token atomically: only one concurrent request can flip usedAt from null.
    const claimed = await tx.passwordResetToken.updateMany({
      where: { tokenHash, usedAt: null, expiresAt: { gt: now } },
      data: { usedAt: now },
    });
    if (claimed.count !== 1) return { ok: false as const, reason: "used" as const };

    const { userId } = await tx.passwordResetToken.findUniqueOrThrow({ where: { tokenHash }, select: { userId: true } });
    await tx.user.update({ where: { id: userId }, data: { passwordHash } });
    await tx.passwordResetToken.deleteMany({ where: { userId, tokenHash: { not: tokenHash } } });
    // Sign out everywhere: whoever had the old password loses access.
    await tx.session.deleteMany({ where: { userId } });
    return { ok: true as const, userId };
  });
}
