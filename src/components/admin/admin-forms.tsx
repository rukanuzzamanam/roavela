"use client";

import { useActionState, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icons";
import { cn } from "@/lib/utils";
import type { AdminFormState } from "@/server/actions/admin-form";

/**
 * Admin form controls. High-impact actions are two-step: the first click opens a confirmation
 * panel (with the required reason fields); only "Confirm" submits. There are no browser dialogs.
 * Everything entered here is re-validated on the server — the UI only makes mistakes less likely.
 */
type Action = (prev: AdminFormState, fd: FormData) => Promise<AdminFormState>;

export type FieldSpec =
  | { type: "textarea"; name: string; label: string; required?: boolean; hint?: string; rows?: number; maxLength?: number; defaultValue?: string }
  | { type: "text"; name: string; label: string; required?: boolean; hint?: string; inputMode?: "decimal" | "text"; inputType?: "text" | "date"; placeholder?: string; defaultValue?: string; maxLength?: number }
  | { type: "select"; name: string; label: string; options: { value: string; label: string }[]; required?: boolean; hint?: string; defaultValue?: string }
  | { type: "checkbox"; name: string; label: string; required?: boolean; defaultChecked?: boolean };

const control = "block w-full rounded-xl border border-ink/15 bg-white px-3.5 py-2.5 text-sm focus:border-eucalypt-500 focus:ring-2 focus:ring-eucalypt-500/25 focus:outline-none";

function Field({ spec, error, autoFocus }: { spec: FieldSpec; error?: string; autoFocus?: boolean }) {
  const id = useId();
  const describedBy = error ? `${id}-err` : "hint" in spec && spec.hint ? `${id}-hint` : undefined;
  if (spec.type === "checkbox") {
    return (
      <div>
        <label htmlFor={id} className="flex items-start gap-2.5 text-sm">
          <input id={id} name={spec.name} type="checkbox" required={spec.required} defaultChecked={spec.defaultChecked} autoFocus={autoFocus} aria-describedby={describedBy} className="mt-0.5 size-4 accent-eucalypt-700" />
          <span>{spec.label}</span>
        </label>
        {error && (
          <p id={`${id}-err`} role="alert" className="mt-1 text-sm text-red-700">
            {error}
          </p>
        )}
      </div>
    );
  }
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="block text-sm font-semibold text-ink-soft">
        {spec.label}
        {spec.required && <span className="text-mist"> (required)</span>}
      </label>
      {spec.type === "textarea" ? (
        <textarea id={id} name={spec.name} required={spec.required} rows={spec.rows ?? 3} maxLength={spec.maxLength ?? 2000} defaultValue={spec.defaultValue} autoFocus={autoFocus} aria-invalid={error ? true : undefined} aria-describedby={describedBy} className={control} />
      ) : spec.type === "select" ? (
        <select id={id} name={spec.name} required={spec.required} defaultValue={spec.defaultValue} autoFocus={autoFocus} aria-invalid={error ? true : undefined} aria-describedby={describedBy} className={cn(control, "h-11")}>
          {spec.options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      ) : (
        <input id={id} name={spec.name} type={spec.inputType ?? "text"} required={spec.required} maxLength={spec.maxLength} inputMode={spec.inputMode} placeholder={spec.placeholder} defaultValue={spec.defaultValue} autoFocus={autoFocus} aria-invalid={error ? true : undefined} aria-describedby={describedBy} className={cn(control, "h-11")} />
      )}
      {"hint" in spec && spec.hint && !error && (
        <p id={`${id}-hint`} className="text-xs text-mist">
          {spec.hint}
        </p>
      )}
      {error && (
        <p id={`${id}-err`} role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}

export function FormResult({ state }: { state: AdminFormState }) {
  if (!state.message) return null;
  return state.ok ? (
    <p role="status" className="flex items-start gap-2 rounded-xl bg-eucalypt-50 p-3 text-sm text-eucalypt-800">
      <Icon name="check" size={18} className="shrink-0" />
      {state.message}
    </p>
  ) : (
    <p role="alert" className="flex items-start gap-2 rounded-xl bg-ochre-50 p-3 text-sm text-ochre-700">
      <Icon name="alert" size={18} className="shrink-0" />
      {state.message}
    </p>
  );
}

const TRIGGER: Record<"primary" | "outline" | "danger", { variant: "primary" | "outline"; className?: string }> = {
  primary: { variant: "primary" },
  outline: { variant: "outline" },
  danger: { variant: "outline", className: "border-red-700/40 text-red-800 hover:border-red-700 hover:bg-red-50" },
};

/**
 * A button that expands into a confirmation panel. Used for approve / reject / suspend / refund /
 * commission and every other decision that should never happen from an accidental click.
 */
export function ConfirmAction({
  action,
  hidden,
  label,
  title,
  description,
  confirmLabel,
  tone = "outline",
  fields = [],
  disabled,
  disabledReason,
}: {
  action: Action;
  hidden: Record<string, string>;
  label: string;
  title: string;
  description?: ReactNode;
  confirmLabel: string;
  tone?: "primary" | "outline" | "danger";
  fields?: FieldSpec[];
  disabled?: boolean;
  disabledReason?: string;
}) {
  const [state, formAction, pending] = useActionState<AdminFormState, FormData>(action, {});
  // The panel is open from the result it was opened at until a NEWER successful result arrives.
  const [openedAt, setOpenedAt] = useState<number | null>(null);
  const open = openedAt !== null && !(state.ok && (state.at ?? 0) !== openedAt);
  const setOpen = (value: boolean) => setOpenedAt(value ? (state.at ?? 0) : null);
  const panelId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);

  const t = TRIGGER[tone];
  return (
    <div className="space-y-2">
      {!open ? (
        <>
          <Button ref={triggerRef} variant={t.variant} className={t.className} disabled={disabled} aria-expanded={false} aria-controls={panelId} onClick={() => setOpen(true)}>
            {label}
          </Button>
          {disabled && disabledReason && <p className="text-xs text-mist">{disabledReason}</p>}
        </>
      ) : (
        <form id={panelId} action={formAction} className={cn("space-y-3 rounded-2xl border p-4", tone === "danger" ? "border-red-700/30 bg-red-50/40" : "border-ink/15 bg-sand-50")}>
          {Object.entries(hidden).map(([k, v]) => (
            <input key={k} type="hidden" name={k} value={v} />
          ))}
          <p className="font-semibold">{title}</p>
          {description && <div className="text-sm text-ink-soft">{description}</div>}
          {fields.map((f, i) => (
            <Field key={f.name} spec={f} error={state.fieldErrors?.[f.name]} autoFocus={i === 0} />
          ))}
          {!state.ok && <FormResult state={state} />}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" variant={tone === "danger" ? "outline" : "primary"} className={tone === "danger" ? "border-red-800 bg-red-800 text-white hover:bg-red-900" : undefined} disabled={pending}>
              {pending ? "Working…" : confirmLabel}
            </Button>
            <Button
              variant="ghost"
              disabled={pending}
              onClick={() => {
                setOpen(false);
                queueMicrotask(() => triggerRef.current?.focus());
              }}
            >
              Cancel
            </Button>
          </div>
        </form>
      )}
      {state.ok && !open && <FormResult state={state} />}
    </div>
  );
}

/** Single-step form for low-impact actions (e.g. adding an internal note). */
export function SimpleForm({ action, hidden, fields, submitLabel, className }: { action: Action; hidden: Record<string, string>; fields: FieldSpec[]; submitLabel: string; className?: string }) {
  const [state, formAction, pending] = useActionState<AdminFormState, FormData>(action, {});
  const formRef = useRef<HTMLFormElement>(null);
  const lastAt = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (state.at && state.at !== lastAt.current) {
      lastAt.current = state.at;
      if (state.ok) formRef.current?.reset();
    }
  }, [state]);
  return (
    <form ref={formRef} action={formAction} className={cn("space-y-3", className)}>
      {Object.entries(hidden).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      {fields.map((f) => (
        <Field key={f.name} spec={f} error={state.fieldErrors?.[f.name]} />
      ))}
      <FormResult state={state} />
      <Button type="submit" variant="outline" size="sm" disabled={pending}>
        {pending ? "Saving…" : submitLabel}
      </Button>
    </form>
  );
}
