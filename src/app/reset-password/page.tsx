import type { Metadata } from "next";
import { AuthShell } from "@/components/auth/auth-shell";
import { ResetPasswordForm } from "@/components/auth/password-reset-forms";
import { ResetLinkProblem } from "@/components/auth/reset-link-problem";
import { inspectResetToken } from "@/server/services/password-reset";

export const metadata: Metadata = {
  title: "Choose a new password",
  robots: { index: false, follow: false },
  // Don't leak the token in the Referer header if the user follows a link from this page.
  referrer: "no-referrer",
};

export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ token?: string | string[] }> }) {
  const raw = (await searchParams).token;
  const token = typeof raw === "string" ? raw : "";
  // Check up-front so an expired/used link shows a clear state instead of a form that can't work.
  const state = await inspectResetToken(token);

  return (
    <AuthShell title="Choose a new password" subtitle="Pick something you haven't used for Roavela before.">
      {state === "valid" ? <ResetPasswordForm token={token} /> : <ResetLinkProblem reason={state} />}
    </AuthShell>
  );
}
