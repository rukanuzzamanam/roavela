import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthForm } from "@/components/auth/auth-form";
import { AuthShell } from "@/components/auth/auth-shell";
import { safeRedirectPath } from "@/lib/utils";
import { getCurrentUser } from "@/server/auth/session";

export const metadata: Metadata = { title: "Create an account", robots: { index: false } };

export default async function SignUpPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  const safeNext = next ? safeRedirectPath(next) : undefined;
  if (await getCurrentUser()) redirect(safeNext ?? "/account");

  return (
    <AuthShell title="Create your account" subtitle="Save stays you love and plan your next drive.">
      <AuthForm mode="signup" next={safeNext} />
    </AuthShell>
  );
}
