"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input, Select, controlClasses } from "@/components/ui/field";
import { Icon } from "@/components/ui/icons";
import type { ListingIntent } from "@/lib/listing-lifecycle";
import { cn } from "@/lib/utils";
import {
  complianceFileAction,
  createPropertyAction,
  listingStatusAction,
  saveHostProfileAction,
  uploadAvatarAction,
  type HostFormState,
} from "@/server/actions/host";
import { FormMessage } from "./host-ui";
import { BasicsFields } from "./section-fields";

export interface HostProfileValues {
  displayName: string;
  bio: string | null;
  hostType: "INDIVIDUAL" | "BUSINESS";
  legalName: string | null;
  businessName: string | null;
  abn: string | null;
  phone: string | null;
}

export function HostProfileForm({ values, submitLabel, then }: { values: Partial<HostProfileValues>; submitLabel: string; then?: "new-property" }) {
  const [state, action, pending] = useActionState<HostFormState, FormData>(saveHostProfileAction, {});
  const [hostType, setHostType] = useState(values.hostType ?? "INDIVIDUAL");
  const e = state.fieldErrors;
  return (
    <form action={action} className="space-y-8" noValidate>
      {then && <input type="hidden" name="then" value={then} />}
      <FormMessage state={state} />
      {state.ok && (
        <p role="status" className="flex items-center gap-2 rounded-2xl bg-eucalypt-50 p-3.5 text-sm font-semibold text-eucalypt-800">
          <Icon name="check" size={18} /> Host profile saved.
        </p>
      )}

      <fieldset className="space-y-5">
        <legend className="mb-1 font-display text-2xl">Public profile</legend>
        <p className="text-sm text-mist">Shown to guests on your listings.</p>
        <Input label="Display name" name="displayName" maxLength={40} defaultValue={values.displayName} error={e?.displayName} hint="Your first name or your business's trading name." />
        <div className="space-y-1.5">
          <label htmlFor="bio" className="block text-sm font-semibold text-ink-soft">
            About you (optional)
          </label>
          <textarea id="bio" name="bio" rows={4} maxLength={600} defaultValue={values.bio ?? ""} className={cn(controlClasses, "py-3")} aria-invalid={e?.bio ? true : undefined} />
          {e?.bio && <p className="text-sm text-red-700">{e.bio}</p>}
        </div>
      </fieldset>

      <fieldset className="space-y-5">
        <legend className="mb-1 font-display text-2xl">Private details</legend>
        <p className="text-sm text-mist">Only Roavela sees these. They&apos;re never shown on your listing.</p>
        <Select label="Hosting as" name="hostType" value={hostType} onChange={(ev) => setHostType(ev.target.value as "INDIVIDUAL" | "BUSINESS")} error={e?.hostType}>
          <option value="INDIVIDUAL">An individual</option>
          <option value="BUSINESS">A business</option>
        </Select>
        <Input label="Legal name" name="legalName" autoComplete="name" maxLength={100} defaultValue={values.legalName ?? ""} error={e?.legalName} />
        {hostType === "BUSINESS" && <Input label="Business name" name="businessName" autoComplete="organization" maxLength={120} defaultValue={values.businessName ?? ""} error={e?.businessName} />}
        <Input label="ABN (optional)" name="abn" inputMode="numeric" maxLength={14} defaultValue={values.abn ?? ""} error={e?.abn} hint="If you have an Australian Business Number." />
        <Input label="Phone" name="phone" type="tel" autoComplete="tel" maxLength={24} defaultValue={values.phone ?? ""} error={e?.phone} hint="So Roavela can contact you about your listings." />
      </fieldset>

      <Button type="submit" size="lg" disabled={pending}>
        {pending ? "Saving…" : submitLabel}
      </Button>
    </form>
  );
}

export function AvatarForm({ current }: { current: string | null }) {
  const [state, action, pending] = useActionState<HostFormState, FormData>(uploadAvatarAction, {});
  return (
    <form action={action} className="flex flex-wrap items-center gap-4">
      {current ? (
        // eslint-disable-next-line @next/next/no-img-element -- small avatar preview
        <img src={current} alt="Your profile photo" className="size-16 rounded-full object-cover" />
      ) : (
        <span className="grid size-16 place-items-center rounded-full bg-sand-200 text-mist">
          <Icon name="user" size={26} />
        </span>
      )}
      <div className="space-y-1">
        <label htmlFor="avatar" className="block text-sm font-semibold text-ink-soft">
          Profile photo (optional)
        </label>
        <input id="avatar" name="avatar" type="file" accept="image/jpeg,image/png,image/webp" className="text-sm" />
        <FormMessage state={state} />
      </div>
      <Button type="submit" variant="outline" size="sm" disabled={pending}>
        {pending ? "Uploading…" : "Upload"}
      </Button>
    </form>
  );
}

export function NewPropertyForm() {
  const [state, action, pending] = useActionState<HostFormState, FormData>(createPropertyAction, {});
  return (
    <form action={action} className="space-y-6" noValidate>
      <FormMessage state={state} />
      <BasicsFields errors={state.fieldErrors} />
      <Button type="submit" size="lg" disabled={pending}>
        {pending ? "Creating…" : "Create draft & continue"}
        <Icon name="arrowRight" size={16} />
      </Button>
    </form>
  );
}

const INTENT_COPY: Record<string, { label: string; variant: "accent" | "outline" | "ghost" | "primary"; confirm?: string }> = {
  submit: { label: "Submit for review", variant: "accent" },
  withdraw: { label: "Withdraw from review", variant: "outline", confirm: "Withdraw this listing from review so you can edit it?" },
  pause: { label: "Pause listing", variant: "outline", confirm: "Pause this listing? It will be hidden from search until you resume it." },
  resume: { label: "Resume listing", variant: "primary" },
  archive: { label: "Archive", variant: "ghost", confirm: "Archive this listing? It will be kept for your records but can't be restored from the dashboard." },
};

export function ListingActions({ propertyId, intents, canSubmit }: { propertyId: string; intents: ListingIntent[]; canSubmit: boolean }) {
  const [state, action, pending] = useActionState<HostFormState, FormData>(listingStatusAction, {});
  if (intents.length === 0) return null;
  return (
    <form
      action={action}
      className="space-y-3"
      onSubmit={(e) => {
        const intent = (e.nativeEvent as SubmitEvent).submitter?.getAttribute("value") ?? "";
        const confirmText = INTENT_COPY[intent]?.confirm;
        if (confirmText && !window.confirm(confirmText)) e.preventDefault();
      }}
    >
      <input type="hidden" name="propertyId" value={propertyId} />
      <FormMessage state={state} />
      {state.ok && (
        <p role="status" className="text-sm font-semibold text-eucalypt-700">
          Listing updated.
        </p>
      )}
      <div className="flex flex-wrap gap-3">
        {intents.map((intent) => (
          <Button key={intent} type="submit" name="intent" value={intent} variant={INTENT_COPY[intent]!.variant} disabled={pending || (intent === "submit" && !canSubmit)}>
            {INTENT_COPY[intent]!.label}
          </Button>
        ))}
      </div>
      {intents.includes("submit") && !canSubmit && <p className="text-sm text-mist">Complete every item in the checklist to submit.</p>}
    </form>
  );
}

export function ComplianceFileForm({ propertyId, type, label, hasFile }: { propertyId: string; type: string; label: string; hasFile: boolean }) {
  const [state, action, pending] = useActionState<HostFormState, FormData>(complianceFileAction, {});
  const id = `doc-${type}`;
  return (
    <form action={action} className="flex flex-wrap items-end gap-3 rounded-2xl border border-ink/10 bg-white p-4">
      <input type="hidden" name="propertyId" value={propertyId} />
      <input type="hidden" name="type" value={type} />
      <div className="min-w-0 flex-1 space-y-1">
        <label htmlFor={id} className="block text-sm font-semibold">
          {label} {hasFile && <span className="font-normal text-eucalypt-700">· document on file</span>}
        </label>
        <input id={id} name="document" type="file" accept="application/pdf,image/jpeg,image/png,image/webp" className="max-w-full text-sm" />
        <FormMessage state={state} />
        {state.ok && <p className="text-sm font-semibold text-eucalypt-700">Uploaded privately.</p>}
      </div>
      <Button type="submit" size="sm" variant="outline" disabled={pending}>
        {pending ? "Uploading…" : hasFile ? "Replace" : "Upload"}
      </Button>
    </form>
  );
}
