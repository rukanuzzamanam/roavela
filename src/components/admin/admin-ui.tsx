import Link from "next/link";
import type { ReactNode } from "react";
import { Badge, Card } from "@/components/ui/feedback";
import { Icon } from "@/components/ui/icons";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";

/**
 * Admin presentation primitives (server components). Status is always conveyed by TEXT — colour only
 * reinforces it — and tables keep real table semantics on every screen size: below `md` each row is
 * laid out as a card with the column name repeated beside each value, so nothing needs sideways
 * scrolling on a phone.
 */

export function AdminHeader({ eyebrow, title, description, actions }: { eyebrow?: string; title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {eyebrow && <p className="text-sm font-bold tracking-wider text-ochre-600 uppercase">{eyebrow}</p>}
        <h1 className="mt-1 text-3xl leading-tight break-words sm:text-4xl">{title}</h1>
        {description && <div className="mt-2 max-w-3xl text-ink-soft">{description}</div>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export type Tone = "neutral" | "warning" | "success" | "demo" | "accent";

export function StatusPill({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return <Badge tone={tone}>{children}</Badge>;
}

export function TestModeBadge() {
  return (
    <span className="inline-flex items-center rounded-md bg-ochre-500 px-2 py-0.5 text-xs font-bold tracking-wider text-white" title="Stripe TEST MODE — no real money moves">
      TEST MODE
    </span>
  );
}

export function DemoBadge() {
  return <Badge tone="demo">Demo data</Badge>;
}

export function money(cents: number | null | undefined, currency = "AUD") {
  return cents === null || cents === undefined ? "—" : formatMoney(cents, currency, { showCents: true });
}

export function dateTime(d: Date | null | undefined) {
  return d ? new Intl.DateTimeFormat("en-AU", { dateStyle: "medium", timeStyle: "short", timeZone: "Australia/Sydney" }).format(d) : "—";
}

export function day(d: Date | null | undefined) {
  return d ? new Intl.DateTimeFormat("en-AU", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(d) : "—";
}

export function MetricCard({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: ReactNode; tone?: "attention" }) {
  return (
    <Card className={cn("p-5", tone === "attention" && "border-ochre-300")}>
      <dt className="text-sm text-mist">{label}</dt>
      <dd className="mt-1 font-display text-3xl tabular-nums">{value}</dd>
      {hint && <dd className="mt-1 text-xs text-mist">{hint}</dd>}
    </Card>
  );
}

export function Section({ id, title, description, actions, children, className }: { id: string; title: string; description?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section aria-labelledby={id} className={cn("scroll-mt-24", className)}>
      <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 id={id} className="text-2xl">
            {title}
          </h2>
          {description && <p className="mt-1 text-sm text-mist">{description}</p>}
        </div>
        {actions}
      </div>
      {children}
    </section>
  );
}

export function Facts({ items, className }: { items: [string, ReactNode][]; className?: string }) {
  return (
    <dl className={cn("grid gap-x-6 gap-y-3 sm:grid-cols-2", className)}>
      {items.map(([k, v]) => (
        <div key={k} className="min-w-0">
          <dt className="text-xs font-semibold tracking-wide text-mist uppercase">{k}</dt>
          <dd className="mt-0.5 break-words">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

export interface Column {
  label: string;
  className?: string;
  /** Visually hide the header (it stays available to screen readers). */
  srOnly?: boolean;
}

export function AdminTable({ caption, columns, rows, empty }: { caption: string; columns: Column[]; rows: { key: string; cells: ReactNode[] }[]; empty: ReactNode }) {
  if (rows.length === 0) return <>{empty}</>;
  return (
    <div className="rounded-2xl border border-ink/10 bg-white">
      <table className="w-full text-left text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead className="hidden border-b border-ink/10 text-xs tracking-wide text-mist uppercase md:table-header-group">
          <tr>
            {columns.map((c) => (
              <th key={c.label} scope="col" className={cn("px-4 py-3 font-semibold", c.srOnly && "sr-only", c.className)}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-ink/8">
          {rows.map((r) => (
            <tr key={r.key} className="block p-4 md:table-row md:p-0">
              {r.cells.map((cell, i) => (
                <td
                  key={columns[i]?.label ?? i}
                  data-label={columns[i]?.srOnly ? "" : columns[i]?.label}
                  className={cn(
                    "flex justify-between gap-4 py-1 align-top md:table-cell md:px-4 md:py-3",
                    "before:shrink-0 before:text-xs before:font-semibold before:text-mist before:content-[attr(data-label)] md:before:content-none",
                    columns[i]?.className,
                  )}
                >
                  <div className="min-w-0 text-right md:text-left">{cell}</div>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Link-based tabs for list filters (URL state: shareable, reloadable, no JS needed). */
export function FilterTabs({ label, items }: { label: string; items: { href: string; label: string; active: boolean; count?: number }[] }) {
  return (
    <nav aria-label={label} className="scrollbar-none -mx-4 mb-4 flex gap-1 overflow-x-auto px-4 sm:mx-0 sm:flex-wrap sm:px-0">
      {items.map((i) => (
        <Link
          key={i.href}
          href={i.href}
          aria-current={i.active ? "page" : undefined}
          className={cn("inline-flex min-h-10 shrink-0 items-center gap-1.5 rounded-full px-3.5 text-sm font-semibold", i.active ? "bg-eucalypt-700 text-white" : "bg-white text-ink-soft ring-1 ring-ink/10 hover:bg-sand-100")}
        >
          {i.label}
          {i.count !== undefined && <span className={cn("rounded-full px-1.5 text-xs", i.active ? "bg-white/20" : "bg-sand-100")}>{i.count}</span>}
        </Link>
      ))}
    </nav>
  );
}

/** GET search form: keeps the other filters as hidden fields so searching doesn't reset them. */
export function SearchForm({ action, q, placeholder, hidden = {}, children }: { action: string; q?: string; placeholder: string; hidden?: Record<string, string | undefined>; children?: ReactNode }) {
  return (
    <form action={action} method="get" role="search" className="mb-4 flex flex-wrap items-end gap-2">
      {Object.entries(hidden).map(([k, v]) => (v ? <input key={k} type="hidden" name={k} value={v} /> : null))}
      <label className="min-w-0 flex-1 basis-64">
        <span className="sr-only">Search</span>
        <input
          type="search"
          name="q"
          defaultValue={q}
          maxLength={100}
          placeholder={placeholder}
          className="block h-11 w-full rounded-xl border border-ink/15 bg-white px-3.5 text-sm focus:border-eucalypt-500 focus:ring-2 focus:ring-eucalypt-500/25 focus:outline-none"
        />
      </label>
      {children}
      <button type="submit" className="inline-flex h-11 items-center gap-2 rounded-full bg-eucalypt-700 px-5 text-sm font-semibold text-white hover:bg-eucalypt-800">
        <Icon name="search" size={16} /> Search
      </button>
    </form>
  );
}

export function selectClasses() {
  return "h-11 rounded-xl border border-ink/15 bg-white px-3 text-sm focus:border-eucalypt-500 focus:ring-2 focus:ring-eucalypt-500/25 focus:outline-none";
}

export function ResultCount({ total, page, pageSize, noun }: { total: number; page: number; pageSize: number; noun: string }) {
  if (total === 0) return null;
  const start = (page - 1) * pageSize + 1;
  const end = Math.min(total, page * pageSize);
  return (
    <p className="mb-3 text-sm text-mist" aria-live="polite">
      Showing {start}–{end} of {total.toLocaleString("en-AU")} {noun}
    </p>
  );
}

export function InlineLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="font-semibold text-eucalypt-700 hover:underline">
      {children}
    </Link>
  );
}

export function Notice({ tone = "info", children }: { tone?: "info" | "warning"; children: ReactNode }) {
  return (
    <div role="note" className={cn("flex gap-3 rounded-2xl p-4 text-sm", tone === "warning" ? "bg-ochre-50 text-ochre-700" : "bg-eucalypt-50 text-eucalypt-800")}>
      <Icon name={tone === "warning" ? "alert" : "shield"} size={18} className="mt-0.5 shrink-0" />
      <div>{children}</div>
    </div>
  );
}

export function Timeline({ entries }: { entries: { id: string; at: Date; title: ReactNode; detail?: ReactNode; who?: string }[] }) {
  if (entries.length === 0) return <p className="text-sm text-mist">No history recorded yet.</p>;
  return (
    <ol className="space-y-3 border-l-2 border-sand-200 pl-4">
      {entries.map((e) => (
        <li key={e.id} className="relative">
          <span aria-hidden className="absolute top-1.5 -left-[1.3rem] size-2.5 rounded-full bg-eucalypt-500" />
          <p className="text-sm font-semibold">{e.title}</p>
          <p className="text-xs text-mist">
            {dateTime(e.at)}
            {e.who && <> · {e.who}</>}
          </p>
          {e.detail && <div className="mt-1 text-sm text-ink-soft">{e.detail}</div>}
        </li>
      ))}
    </ol>
  );
}
