"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { Icon } from "@/components/ui/icons";
import { signIn, signUp, type AuthFormState } from "@/server/actions/auth";

export function AuthForm({ mode, next }: { mode: "login" | "signup"; next?: string }) {
  const [state, action, pending] = useActionState<AuthFormState, FormData>(mode === "login" ? signIn : signUp, {});
  const isSignup = mode === "signup";

  return (
    <form action={action} className="space-y-5" noValidate>
      {next && <input type="hidden" name="next" value={next} />}

      {state.error && (
        <p role="alert" className="flex items-start gap-2 rounded-2xl bg-ochre-50 p-3.5 text-sm text-ochre-700">
          <Icon name="alert" size={18} className="shrink-0" />
          {state.error}
        </p>
      )}

      {isSignup && (
        <Input
          label="Full name"
          name="name"
          autoComplete="name"
          required
          maxLength={80}
          defaultValue={state.values?.name}
          error={state.fieldErrors?.name}
        />
      )}
      <Input
        label="Email"
        name="email"
        type="email"
        autoComplete="email"
        inputMode="email"
        required
        maxLength={254}
        defaultValue={state.values?.email}
        error={state.fieldErrors?.email}
      />
      <Input
        label="Password"
        name="password"
        type="password"
        autoComplete={isSignup ? "new-password" : "current-password"}
        required
        minLength={isSignup ? 10 : undefined}
        maxLength={isSignup ? 72 : 200}
        hint={isSignup ? "At least 10 characters, with a number or symbol." : undefined}
        error={state.fieldErrors?.password}
      />
      {!isSignup && (
        <p className="-mt-2 text-right text-sm">
          <Link href="/forgot-password" className="font-semibold text-eucalypt-700 underline-offset-4 hover:underline">
            Forgot password?
          </Link>
        </p>
      )}

      <Button type="submit" size="lg" className="w-full" disabled={pending}>
        {pending ? (isSignup ? "Creating account…" : "Logging in…") : isSignup ? "Create account" : "Log in"}
      </Button>

      <p className="text-center text-sm text-mist">
        {isSignup ? (
          <>
            Already have an account?{" "}
            <Link href={`/login${next ? `?next=${encodeURIComponent(next)}` : ""}`} className="font-semibold text-eucalypt-700 underline-offset-4 hover:underline">
              Log in
            </Link>
          </>
        ) : (
          <>
            New to Roavela?{" "}
            <Link href={`/signup${next ? `?next=${encodeURIComponent(next)}` : ""}`} className="font-semibold text-eucalypt-700 underline-offset-4 hover:underline">
              Create an account
            </Link>
          </>
        )}
      </p>
    </form>
  );
}
