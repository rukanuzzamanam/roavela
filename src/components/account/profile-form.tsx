"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { Icon } from "@/components/ui/icons";
import { updateProfile, type ProfileFormState } from "@/server/actions/account";

export function ProfileForm({ initial }: { initial: { name: string; phone: string; email: string } }) {
  const [state, action, pending] = useActionState<ProfileFormState, FormData>(updateProfile, {});
  const values = state.values ?? initial;

  return (
    <form action={action} className="space-y-5" noValidate>
      {state.ok && (
        <p role="status" className="flex items-center gap-2 rounded-2xl bg-eucalypt-50 p-3.5 text-sm font-semibold text-eucalypt-800">
          <Icon name="check" size={18} />
          Profile updated.
        </p>
      )}
      {state.error && (
        <p role="alert" className="flex items-start gap-2 rounded-2xl bg-ochre-50 p-3.5 text-sm text-ochre-700">
          <Icon name="alert" size={18} className="shrink-0" />
          {state.error}
        </p>
      )}

      <Input label="Full name" name="name" autoComplete="name" required maxLength={80} defaultValue={values.name} error={state.fieldErrors?.name} key={`name-${values.name}`} />
      <Input
        label="Phone (optional)"
        name="phone"
        type="tel"
        autoComplete="tel"
        inputMode="tel"
        maxLength={24}
        defaultValue={values.phone}
        error={state.fieldErrors?.phone}
        hint="Only shared with a host once you've booked with them."
        key={`phone-${values.phone}`}
      />
      <Input label="Email" name="email-display" type="email" value={initial.email} readOnly disabled hint="Email changes need verification and aren't available yet. Contact support if you need to change it." />

      <Button type="submit" size="lg" disabled={pending}>
        {pending ? "Saving…" : "Save changes"}
      </Button>
    </form>
  );
}
