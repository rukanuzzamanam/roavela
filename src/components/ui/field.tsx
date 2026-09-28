import { useId, type ComponentProps, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Icon } from "./icons";

export const controlClasses =
  "block w-full rounded-xl border border-ink/15 bg-white px-3.5 text-[0.9375rem] text-ink placeholder:text-mist/70 " +
  "transition-colors hover:border-ink/30 focus:border-eucalypt-500 focus:outline-none focus:ring-2 focus:ring-eucalypt-500/25 " +
  "disabled:cursor-not-allowed disabled:bg-sand-100 aria-invalid:border-red-600 aria-invalid:ring-red-600/20";

interface FieldProps {
  label: ReactNode;
  hint?: ReactNode;
  error?: string;
  /** Visually hide the label (it stays available to screen readers). */
  hideLabel?: boolean;
}

function FieldShell({
  id,
  label,
  hint,
  error,
  hideLabel,
  children,
}: FieldProps & { id: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className={cn("block text-sm font-semibold text-ink-soft", hideLabel && "sr-only")}>
        {label}
      </label>
      {children}
      {hint && !error && (
        <p id={`${id}-hint`} className="text-xs text-mist">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} className="flex items-center gap-1 text-sm text-red-700" role="alert">
          <Icon name="alert" size={14} />
          {error}
        </p>
      )}
    </div>
  );
}

function describedBy(id: string, hint?: ReactNode, error?: string) {
  return error ? `${id}-error` : hint ? `${id}-hint` : undefined;
}

export function Input({ label, hint, error, hideLabel, className, id: idProp, ...props }: FieldProps & ComponentProps<"input">) {
  const autoId = useId();
  const id = idProp ?? autoId;
  return (
    <FieldShell id={id} label={label} hint={hint} error={error} hideLabel={hideLabel}>
      <input
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, hint, error)}
        className={cn(controlClasses, "h-12", className)}
        {...props}
      />
    </FieldShell>
  );
}

export function Select({
  label,
  hint,
  error,
  hideLabel,
  className,
  id: idProp,
  children,
  ...props
}: FieldProps & ComponentProps<"select">) {
  const autoId = useId();
  const id = idProp ?? autoId;
  return (
    <FieldShell id={id} label={label} hint={hint} error={error} hideLabel={hideLabel}>
      <div className="relative">
        <select
          id={id}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy(id, hint, error)}
          className={cn(controlClasses, "h-12 appearance-none pr-10", className)}
          {...props}
        >
          {children}
        </select>
        <Icon name="chevronDown" size={18} className="pointer-events-none absolute top-1/2 right-3.5 -translate-y-1/2 text-mist" />
      </div>
    </FieldShell>
  );
}

/**
 * Date picker. Uses the native date input deliberately: it gives every platform its own
 * accessible, keyboard- and screen-reader-friendly picker (and the best mobile experience).
 */
export function DatePicker(props: FieldProps & Omit<ComponentProps<"input">, "type">) {
  return <Input type="date" {...props} />;
}
