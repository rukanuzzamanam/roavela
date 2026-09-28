"use server";

import { redirect } from "next/navigation";
import { Prisma } from "@/generated/prisma/client";
import { safeRedirectPath } from "@/lib/utils";
import { signInSchema, signUpSchema } from "@/lib/validation/auth";
import { hashPassword, verifyPassword } from "@/server/auth/password";
import { createSession, destroySession } from "@/server/auth/session";
import { prisma } from "@/server/db";
import { getRateLimiter, RATE_LIMITS } from "@/server/rate-limit";
import { getRequestMeta } from "@/server/request";

export interface AuthFormState {
  error?: string;
  fieldErrors?: Partial<Record<"name" | "email" | "password", string>>;
  /** Echo non-sensitive fields back so the form is not wiped on error. Never echo passwords. */
  values?: { name?: string; email?: string };
}

const TOO_MANY = "Too many attempts. Please wait a few minutes and try again.";

function firstErrors(issues: { path: PropertyKey[]; message: string }[]) {
  const out: AuthFormState["fieldErrors"] = {};
  for (const issue of issues) {
    const field = issue.path[0] as keyof NonNullable<AuthFormState["fieldErrors"]>;
    if (field && !out[field]) out[field] = issue.message;
  }
  return out;
}

export async function signUp(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const raw = {
    name: String(formData.get("name") ?? ""),
    email: String(formData.get("email") ?? ""),
    password: String(formData.get("password") ?? ""),
  };
  const values = { name: raw.name.slice(0, 80), email: raw.email.slice(0, 254) };

  const meta = await getRequestMeta();
  const limit = await getRateLimiter().consume(`signup:${meta.ipAddress}`, RATE_LIMITS.signUp);
  if (!limit.success) return { error: TOO_MANY, values };

  const parsed = signUpSchema.safeParse(raw);
  if (!parsed.success) return { fieldErrors: firstErrors(parsed.error.issues), values };

  let userId: string;
  try {
    const user = await prisma.user.create({
      data: {
        name: parsed.data.name,
        email: parsed.data.email,
        passwordHash: await hashPassword(parsed.data.password),
        // Role is never taken from the request. Everyone starts as a CUSTOMER; hosting is an
        // explicit onboarding flow and ADMIN is granted out-of-band.
        role: "CUSTOMER",
      },
      select: { id: true },
    });
    userId = user.id;
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return { fieldErrors: { email: "An account with this email already exists. Try logging in." }, values };
    }
    throw e;
  }

  await createSession(userId, meta);
  redirect(safeRedirectPath(formData.get("next"), "/account"));
}

export async function signIn(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const raw = { email: String(formData.get("email") ?? ""), password: String(formData.get("password") ?? "") };
  const values = { email: raw.email.slice(0, 254) };

  const parsed = signInSchema.safeParse(raw);
  if (!parsed.success) return { fieldErrors: firstErrors(parsed.error.issues), values };

  const meta = await getRequestMeta();
  const limiter = getRateLimiter();
  // Limit per IP and per account, so one attacker can't brute-force many accounts or one account from many IPs.
  const [byIp, byEmail] = await Promise.all([
    limiter.consume(`signin:ip:${meta.ipAddress}`, RATE_LIMITS.signIn),
    limiter.consume(`signin:email:${parsed.data.email}`, RATE_LIMITS.signIn),
  ]);
  if (!byIp.success || !byEmail.success) return { error: TOO_MANY, values };

  const user = await prisma.user.findUnique({
    where: { email: parsed.data.email },
    select: { id: true, passwordHash: true, status: true },
  });
  const valid = await verifyPassword(parsed.data.password, user?.passwordHash);
  if (!user || !valid) return { error: "Incorrect email or password.", values };
  if (user.status !== "ACTIVE") {
    return { error: "This account is unavailable. Please contact support.", values };
  }

  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  await createSession(user.id, meta);
  redirect(safeRedirectPath(formData.get("next"), "/"));
}

export async function signOut(): Promise<void> {
  await destroySession();
  redirect("/");
}
