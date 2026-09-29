import Link from "next/link";
import type { ReactNode } from "react";
import { Badge } from "@/components/ui/feedback";
import { Icon } from "@/components/ui/icons";
import type { PropertyStatus } from "@/generated/prisma/enums";
import type { SectionStatus } from "@/lib/listing-checklist";
import { STATUS_LABELS } from "@/lib/listing-lifecycle";
import { cn } from "@/lib/utils";

export function StatusBadge({ status, percent }: { status: PropertyStatus; percent?: number }) {
  const s = STATUS_LABELS[status];
  return (
    <Badge tone={s.tone}>
      {s.label}
      {status === "DRAFT" && percent !== undefined && ` · ${percent}% complete`}
    </Badge>
  );
}

const NAV = [
  { href: "/host", label: "Dashboard", icon: "home" },
  { href: "/host/properties", label: "Properties", icon: "list" },
  { href: "/host/profile", label: "Host profile", icon: "user" },
];

export function HostShell({ current, title, eyebrow, actions, children }: { current: string; title: string; eyebrow?: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <div className="container-page py-8">
      <nav aria-label="Host portal" className="scrollbar-none -mx-4 mb-8 flex gap-1 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        {NAV.map((n) => (
          <Link
            key={n.href}
            href={n.href}
            aria-current={current === n.href ? "page" : undefined}
            className={cn(
              "inline-flex min-h-10 shrink-0 items-center gap-2 rounded-full px-4 text-sm font-semibold transition-colors",
              current === n.href ? "bg-eucalypt-700 text-white" : "text-ink-soft hover:bg-ink/5",
            )}
          >
            <Icon name={n.icon} size={16} />
            {n.label}
          </Link>
        ))}
      </nav>
      <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          {eyebrow && <p className="text-sm font-bold tracking-wider text-ochre-600 uppercase">{eyebrow}</p>}
          <h1 className="mt-1 text-4xl leading-tight">{title}</h1>
        </div>
        {actions}
      </div>
      {children}
    </div>
  );
}

/** Section navigation for a listing. Horizontal scroller on mobile, sidebar on desktop. */
export function SectionStepper({ propertyId, sections, current, horizontal = false }: { propertyId: string; sections: SectionStatus[]; current?: string; /** Keep a single scrolling row on every screen size (e.g. above the preview). */ horizontal?: boolean }) {
  return (
    <nav aria-label="Listing sections">
      <ol className={cn("scrollbar-none -mx-4 flex gap-2 overflow-x-auto px-4 pb-1", !horizontal && "lg:mx-0 lg:flex-col lg:gap-1 lg:overflow-visible lg:px-0")}>
        {sections.map((s, i) => (
          <li key={s.key} className="shrink-0">
            <Link
              href={`/host/properties/${propertyId}/edit/${s.key}`}
              aria-current={current === s.key ? "step" : undefined}
              className={cn(
                "flex min-h-11 items-center gap-3 rounded-2xl px-3 py-2 text-sm font-semibold transition-colors",
                current === s.key ? "bg-eucalypt-700 text-white" : "bg-white text-ink-soft hover:bg-sand-100 lg:bg-transparent",
              )}
            >
              <span
                className={cn(
                  "grid size-6 shrink-0 place-items-center rounded-full text-xs",
                  s.complete ? "bg-eucalypt-500 text-white" : current === s.key ? "bg-white/20" : "bg-sand-200 text-ink-soft",
                )}
                aria-hidden
              >
                {s.complete ? <Icon name="check" size={14} /> : i + 1}
              </span>
              {s.label}
              <span className="sr-only">{s.complete ? "(complete)" : "(incomplete)"}</span>
            </Link>
          </li>
        ))}
        <li className="shrink-0">
          <Link
            href={`/host/properties/${propertyId}/preview`}
            aria-current={current === "preview" ? "step" : undefined}
            className={cn("flex min-h-11 items-center gap-3 rounded-2xl px-3 py-2 text-sm font-semibold", current === "preview" ? "bg-eucalypt-700 text-white" : "bg-white text-ink-soft hover:bg-sand-100 lg:bg-transparent")}
          >
            <span className="grid size-6 place-items-center rounded-full bg-sand-200 text-xs text-ink-soft" aria-hidden>
              <Icon name="eye" size={14} />
            </span>
            Preview & submit
          </Link>
        </li>
      </ol>
    </nav>
  );
}

export function Checklist({ sections, hostIssues, propertyId }: { sections: SectionStatus[]; hostIssues: string[]; propertyId: string }) {
  return (
    <ul className="divide-y divide-ink/8 rounded-2xl border border-ink/10 bg-white">
      {hostIssues.map((issue) => (
        <li key={issue} className="flex items-start gap-3 p-4">
          <Icon name="alert" size={20} className="mt-0.5 shrink-0 text-ochre-600" />
          <div className="min-w-0 flex-1">
            <p className="font-semibold">Host profile</p>
            <p className="text-sm text-ochre-700">{issue}</p>
          </div>
          <Link href="/host/profile" className="text-sm font-semibold text-eucalypt-700 hover:underline">
            Fix
          </Link>
        </li>
      ))}
      {sections.map((s) => (
        <li key={s.key} className="flex items-start gap-3 p-4">
          {s.complete ? (
            <Icon name="check" size={20} className="mt-0.5 shrink-0 text-eucalypt-600" aria-label="Complete" aria-hidden={false} role="img" />
          ) : (
            <Icon name="close" size={20} className="mt-0.5 shrink-0 text-ochre-600" aria-label="Incomplete" aria-hidden={false} role="img" />
          )}
          <div className="min-w-0 flex-1">
            <p className="font-semibold">{s.label}</p>
            {s.issues.map((issue) => (
              <p key={issue} className="text-sm text-ochre-700">
                {issue}
              </p>
            ))}
          </div>
          <Link href={`/host/properties/${propertyId}/edit/${s.key}`} className="shrink-0 text-sm font-semibold text-eucalypt-700 hover:underline">
            {s.complete ? "Edit" : "Complete"}
          </Link>
        </li>
      ))}
    </ul>
  );
}

export function FormMessage({ state }: { state: { ok?: boolean; message?: string } }) {
  if (!state.message || state.ok) return null;
  return (
    <p role="alert" className="flex items-start gap-2 rounded-2xl bg-ochre-50 p-3.5 text-sm text-ochre-700">
      <Icon name="alert" size={18} className="shrink-0" />
      {state.message}
    </p>
  );
}
