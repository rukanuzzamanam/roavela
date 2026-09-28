import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthForm } from "@/components/auth/auth-form";
import { AuthShell } from "@/components/auth/auth-shell";
import { Icon } from "@/components/ui/icons";
import { safeRedirectPath } from "@/lib/utils";
import { getCurrentUser } from "@/server/auth/session";

export const metadata: Metadata = { title: "Log in", robots: { index: false } };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; reset?: string }> }) {
  const { next, reset } = await searchParams;
  const safeNext = next ? safeRedirectPath(next) : undefined;
  if (await getCurrentUser()) redirect(safeNext ?? "/");

  return (
    <AuthShell title="Welcome back" subtitle="Log in to see your saved stays and trips.">
      {reset === "success" && (
        <p role="status" className="mb-6 flex items-center gap-2 rounded-2xl bg-eucalypt-50 p-3.5 text-sm font-semibold text-eucalypt-800">
          <Icon name="check" size={18} />
          Your password has been reset. Log in with your new password.
        </p>
      )}
      <AuthForm mode="login" next={safeNext} />
    </AuthShell>
  );
}
