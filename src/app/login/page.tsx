import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthForm } from "@/components/auth/auth-form";
import { AuthShell } from "@/components/auth/auth-shell";
import { safeRedirectPath } from "@/lib/utils";
import { getCurrentUser } from "@/server/auth/session";

export const metadata: Metadata = { title: "Log in", robots: { index: false } };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  const safeNext = next ? safeRedirectPath(next) : undefined;
  if (await getCurrentUser()) redirect(safeNext ?? "/");

  return (
    <AuthShell title="Welcome back" subtitle="Log in to see your saved stays and trips.">
      <AuthForm mode="login" next={safeNext} />
    </AuthShell>
  );
}
