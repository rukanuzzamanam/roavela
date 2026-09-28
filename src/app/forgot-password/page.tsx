import type { Metadata } from "next";
import { AuthShell } from "@/components/auth/auth-shell";
import { ForgotPasswordForm } from "@/components/auth/password-reset-forms";

export const metadata: Metadata = { title: "Forgot password", robots: { index: false } };

export default function ForgotPasswordPage() {
  return (
    <AuthShell title="Reset your password" subtitle="Enter the email you use for Roavela and we'll send you a reset link.">
      <ForgotPasswordForm />
    </AuthShell>
  );
}
