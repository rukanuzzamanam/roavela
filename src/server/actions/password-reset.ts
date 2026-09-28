"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { emailSchema, passwordSchema } from "@/lib/validation/auth";
import { env } from "@/server/env";
import { track } from "@/server/providers/analytics";
import { getEmailProvider } from "@/server/providers/email";
import { getRateLimiter, RATE_LIMITS } from "@/server/rate-limit";
import { getRequestMeta } from "@/server/request";
import { consumePasswordReset, issuePasswordReset, resetTokenTtlMs } from "@/server/services/password-reset";

export interface ForgotPasswordState {
  /** Always true after a well-formed submission, whether or not the account exists. */
  submitted?: boolean;
  error?: string;
  fieldError?: string;
  email?: string;
}

const TOO_MANY = "Too many requests. Please wait a few minutes and try again.";

export async function requestPasswordReset(_prev: ForgotPasswordState, formData: FormData): Promise<ForgotPasswordState> {
  const rawEmail = String(formData.get("email") ?? "").slice(0, 254);
  const parsed = emailSchema.safeParse(rawEmail);
  if (!parsed.success) return { fieldError: parsed.error.issues[0]?.message ?? "Enter a valid email address", email: rawEmail };
  const email = parsed.data;

  const meta = await getRequestMeta();
  const limiter = getRateLimiter();
  const [byIp, byEmail] = await Promise.all([
    limiter.consume(`reset:ip:${meta.ipAddress}`, RATE_LIMITS.passwordResetRequestByIp),
    limiter.consume(`reset:email:${email}`, RATE_LIMITS.passwordResetRequestByEmail),
  ]);
  if (!byIp.success) return { error: TOO_MANY, email };
  // Per-email limiting is silent: returning an error here would reveal the address was used before.
  if (byEmail.success) {
    const issued = await issuePasswordReset(email);
    if (issued) {
      const link = new URL(`/reset-password?token=${encodeURIComponent(issued.token)}`, env().APP_URL).toString();
      const minutes = Math.round(resetTokenTtlMs() / 60_000);
      // Fire-and-forget so response timing doesn't reveal whether an account exists.
      void getEmailProvider()
        .send({
          to: email,
          subject: "Reset your Roavela password",
          text:
            `Hi ${issued.name.split(" ")[0]},\n\n` +
            `Someone asked to reset the password for your Roavela account. If it was you, use this link within ${minutes} minutes:\n\n${link}\n\n` +
            `The link works once. If you didn't ask for this, you can ignore this email — your password won't change.\n\n— Roavela`,
        })
        .catch((e) => console.error("[password-reset] email delivery failed:", e instanceof Error ? e.message : "unknown"));
    }
  }

  track({ name: "password_reset_requested", properties: {} });
  return { submitted: true, email };
}

export interface ResetPasswordState {
  error?: string;
  reason?: "invalid" | "expired" | "used";
  fieldErrors?: Partial<Record<"password" | "confirm", string>>;
}

const resetSchema = z
  .object({
    token: z.string().min(1).max(200),
    password: passwordSchema,
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, { message: "Passwords don't match", path: ["confirm"] });

export async function resetPassword(_prev: ResetPasswordState, formData: FormData): Promise<ResetPasswordState> {
  const meta = await getRequestMeta();
  const limit = await getRateLimiter().consume(`reset-submit:${meta.ipAddress}`, RATE_LIMITS.passwordResetSubmit);
  if (!limit.success) return { error: TOO_MANY };

  const parsed = resetSchema.safeParse({
    token: String(formData.get("token") ?? ""),
    password: String(formData.get("password") ?? ""),
    confirm: String(formData.get("confirm") ?? ""),
  });
  if (!parsed.success) {
    const fieldErrors: ResetPasswordState["fieldErrors"] = {};
    for (const issue of parsed.error.issues) {
      const field = issue.path[0];
      if (field === "password" || field === "confirm") fieldErrors[field] ??= issue.message;
      if (field === "token") return { reason: "invalid" };
    }
    return { fieldErrors };
  }

  const result = await consumePasswordReset(parsed.data.token, parsed.data.password);
  if (!result.ok) return { reason: result.reason };

  track({ name: "password_reset_completed", properties: {} });
  redirect("/login?reset=success");
}
