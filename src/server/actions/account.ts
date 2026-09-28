"use server";

import { revalidatePath } from "next/cache";
import { profileSchema } from "@/lib/validation/account";
import { authorize, AuthorizationError } from "@/server/auth/guards";
import { prisma } from "@/server/db";
import { track } from "@/server/providers/analytics";
import { getRateLimiter, RATE_LIMITS } from "@/server/rate-limit";

export interface ProfileFormState {
  ok?: boolean;
  error?: string;
  fieldErrors?: Partial<Record<"name" | "phone", string>>;
  values?: { name?: string; phone?: string };
}

/**
 * Update the signed-in user's own profile. The target user is always the session user; the form
 * cannot name another account, and only name/phone are accepted (never email, role or status).
 */
export async function updateProfile(_prev: ProfileFormState, formData: FormData): Promise<ProfileFormState> {
  const raw = { name: String(formData.get("name") ?? ""), phone: String(formData.get("phone") ?? "") };
  const values = { name: raw.name.slice(0, 80), phone: raw.phone.slice(0, 24) };

  let user;
  try {
    user = await authorize("account:manage");
  } catch (e) {
    if (e instanceof AuthorizationError) return { error: "Please log in again to update your profile.", values };
    throw e;
  }

  const limit = await getRateLimiter().consume(`profile:${user.id}`, RATE_LIMITS.profile);
  if (!limit.success) return { error: "Too many updates. Please wait a few minutes and try again.", values };

  const parsed = profileSchema.safeParse(raw);
  if (!parsed.success) {
    const fieldErrors: ProfileFormState["fieldErrors"] = {};
    for (const issue of parsed.error.issues) {
      const field = issue.path[0] as "name" | "phone";
      fieldErrors[field] ??= issue.message;
    }
    return { fieldErrors, values };
  }

  const before = await prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { name: true, phone: true } });
  await prisma.user.update({ where: { id: user.id }, data: parsed.data });

  const changed = (["name", "phone"] as const).filter((f) => before[f] !== parsed.data[f]);
  if (changed.length > 0) track({ name: "account_profile_updated", properties: { fields: [...changed] }, userId: user.id });

  revalidatePath("/account", "layout");
  return { ok: true, values: { name: parsed.data.name, phone: parsed.data.phone ?? "" } };
}
