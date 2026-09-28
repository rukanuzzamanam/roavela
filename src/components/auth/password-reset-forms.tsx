"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { Icon } from "@/components/ui/icons";
import { requestPasswordReset, resetPassword, type ForgotPasswordState, type ResetPasswordState } from "@/server/actions/password-reset";
import { ResetLinkProblem } from "./reset-link-problem";

export function ForgotPasswordForm() {
  const [state, action, pending] = useActionState<ForgotPasswordState, FormData>(requestPasswordReset, {});

  if (state.submitted) {
    // Identical whether or not the account exists.
    return (
      <div role="status" className="space-y-4">
        <p className="flex items-start gap-2 rounded-2xl bg-eucalypt-50 p-4 text-eucalypt-900">
          <Icon name="check" size={20} className="mt-0.5 shrink-0" />
          <span>
            If an account exists for <strong className="break-all">{state.email}</strong>, we&apos;ve sent a link to reset the password. It expires soon and works once.
          </span>
        </p>
        <p className="text-sm text-mist">Didn&apos;t get it? Check your spam folder, or wait a minute and try again.</p>
        <Link href="/login" className="inline-block font-semibold text-eucalypt-700 hover:underline">
          Back to log in
        </Link>
      </div>
    );
  }

  return (
    <form action={action} className="space-y-5" noValidate>
      {state.error && (
        <p role="alert" className="flex items-start gap-2 rounded-2xl bg-ochre-50 p-3.5 text-sm text-ochre-700">
          <Icon name="alert" size={18} className="shrink-0" />
          {state.error}
        </p>
      )}
      <Input label="Email" name="email" type="email" autoComplete="email" inputMode="email" required maxLength={254} defaultValue={state.email} error={state.fieldError} />
      <Button type="submit" size="lg" className="w-full" disabled={pending}>
        {pending ? "Sending…" : "Send reset link"}
      </Button>
      <p className="text-center text-sm text-mist">
        Remembered it?{" "}
        <Link href="/login" className="font-semibold text-eucalypt-700 hover:underline">
          Log in
        </Link>
      </p>
    </form>
  );
}

export function ResetPasswordForm({ token }: { token: string }) {
  const [state, action, pending] = useActionState<ResetPasswordState, FormData>(resetPassword, {});

  if (state.reason) return <ResetLinkProblem reason={state.reason} />;

  return (
    <form action={action} className="space-y-5" noValidate>
      <input type="hidden" name="token" value={token} />
      {state.error && (
        <p role="alert" className="flex items-start gap-2 rounded-2xl bg-ochre-50 p-3.5 text-sm text-ochre-700">
          <Icon name="alert" size={18} className="shrink-0" />
          {state.error}
        </p>
      )}
      <Input
        label="New password"
        name="password"
        type="password"
        autoComplete="new-password"
        required
        minLength={10}
        maxLength={72}
        hint="At least 10 characters, with a number or symbol."
        error={state.fieldErrors?.password}
      />
      <Input label="Confirm new password" name="confirm" type="password" autoComplete="new-password" required maxLength={72} error={state.fieldErrors?.confirm} />
      <Button type="submit" size="lg" className="w-full" disabled={pending}>
        {pending ? "Updating…" : "Set new password"}
      </Button>
      <p className="text-center text-xs text-mist">You&apos;ll be signed out on all devices after resetting.</p>
    </form>
  );
}
