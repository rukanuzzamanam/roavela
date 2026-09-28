"use client";

import { useEffect, useId, useRef, useState } from "react";
import { MAX_GUESTS } from "@/config/search";
import { cn, pluralize } from "@/lib/utils";
import { controlClasses } from "./field";
import { Icon } from "./icons";

interface GuestSelectorProps {
  defaultAdults?: number;
  defaultChildren?: number;
  label?: string;
  className?: string;
}

/**
 * Adults/children picker. Submits `adults` and `children` as hidden inputs so it works inside a
 * plain GET <form>. The popover is a disclosure: toggled by button, closed with Escape or outside click.
 */
export function GuestSelector({ defaultAdults = 2, defaultChildren = 0, label = "Guests", className }: GuestSelectorProps) {
  const [adults, setAdults] = useState(defaultAdults);
  const [children, setChildren] = useState(defaultChildren);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const labelId = useId();

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const total = adults + children;
  const summary = [pluralize(adults, "adult"), children > 0 ? pluralize(children, "child", "children") : null].filter(Boolean).join(", ");

  return (
    <div ref={ref} className={cn("relative space-y-1.5", className)}>
      {/* Hidden inputs first: Tailwind v4 `space-y` adds margin to every non-last child. */}
      <input type="hidden" name="adults" value={adults} />
      <input type="hidden" name="children" value={children} />
      <span id={labelId} className="block text-sm font-semibold text-ink-soft">
        {label}
      </span>
      <button
        ref={buttonRef}
        type="button"
        aria-labelledby={labelId}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((o) => !o)}
        className={cn(controlClasses, "flex h-12 items-center justify-between text-left")}
      >
        <span className="flex items-center gap-2">
          <Icon name="users" size={18} className="text-mist" />
          {summary}
        </span>
        <Icon name="chevronDown" size={18} className={cn("text-mist transition-transform", open && "rotate-180")} />
      </button>

      {open && (
        <div
          id={panelId}
          role="group"
          aria-labelledby={labelId}
          className="absolute top-full right-0 left-0 z-30 mt-2 min-w-64 space-y-4 rounded-2xl border border-ink/10 bg-white p-4 shadow-float"
        >
          <Stepper label="Adults" hint="Ages 13+" value={adults} min={1} max={MAX_GUESTS - children} onChange={setAdults} />
          <Stepper label="Children" hint="Ages 0–12" value={children} min={0} max={MAX_GUESTS - adults} onChange={setChildren} />
          <p className="text-xs text-mist">Up to {MAX_GUESTS} guests. {total >= MAX_GUESTS && "Maximum reached."}</p>
        </div>
      )}
    </div>
  );
}

function Stepper({
  label,
  hint,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  hint: string;
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
}) {
  const btn =
    "grid size-9 place-items-center rounded-full border border-ink/20 text-ink hover:border-ink/50 disabled:opacity-30 disabled:hover:border-ink/20";
  return (
    <div className="flex items-center justify-between gap-4">
      <div>
        <p className="font-semibold">{label}</p>
        <p className="text-xs text-mist">{hint}</p>
      </div>
      <div className="flex items-center gap-3">
        <button type="button" className={btn} onClick={() => onChange(value - 1)} disabled={value <= min} aria-label={`Fewer ${label.toLowerCase()}`}>
          <Icon name="minus" size={16} />
        </button>
        <span className="w-5 text-center font-semibold tabular-nums" aria-live="polite">
          {value}
        </span>
        <button type="button" className={btn} onClick={() => onChange(value + 1)} disabled={value >= max} aria-label={`More ${label.toLowerCase()}`}>
          <Icon name="plus" size={16} />
        </button>
      </div>
    </div>
  );
}
