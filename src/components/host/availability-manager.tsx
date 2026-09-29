"use client";

import { useActionState, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { Icon } from "@/components/ui/icons";
import { addDays, parseIsoDate, toIsoDate } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { availabilityAction, type HostFormState } from "@/server/actions/host";
import { FormMessage } from "./host-ui";
import { keepValuesOnSubmit } from "./section-form";

interface Range {
  start: string;
  end: string; // exclusive
}

/**
 * Host calendar. Choose a start and end night (click two days, or use the date fields), then block
 * or unblock them. Booked nights can't be blocked; the server enforces this too.
 */
export function AvailabilityManager({ propertyId, today, blocked, booked, editable }: { propertyId: string; today: string; blocked: Range[]; booked: Range[]; editable: boolean }) {
  const [state, action, pending] = useActionState<HostFormState, FormData>(availabilityAction, {});
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [monthOffset, setMonthOffset] = useState(0);

  const inRanges = (ranges: Range[], iso: string) => ranges.some((r) => iso >= r.start && iso < r.end);
  const todayDate = parseIsoDate(today);
  const months = useMemo(() => [0, 1].map((m) => monthGrid(todayDate.getUTCFullYear(), todayDate.getUTCMonth() + monthOffset + m)), [monthOffset, todayDate]);

  // First click selects one night and sets an anchor; a second, later click extends the range
  // through that night (end is exclusive). Clicking an earlier day starts a new selection.
  const [anchor, setAnchor] = useState<string | null>(null);
  const nextDay = (iso: string) => toIsoDate(addDays(parseIsoDate(iso), 1));
  function pick(iso: string) {
    if (anchor && iso >= anchor) {
      setStart(anchor);
      setEnd(nextDay(iso));
      setAnchor(null);
    } else {
      setAnchor(iso);
      setStart(iso);
      setEnd(nextDay(iso));
    }
  }
  const selected = (iso: string) => Boolean(start && end && iso >= start && iso < end);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-4 text-sm">
        <Legend className="bg-white ring-1 ring-ink/15" label="Open" />
        <Legend className="bg-ink/70" label="Blocked by you" />
        <Legend className="bg-ochre-300" label="Booked" />
        <Legend className="bg-eucalypt-600" label="Selected" />
      </div>

      <div className="flex items-center justify-between">
        <Button variant="ghost" size="sm" onClick={() => setMonthOffset((m) => Math.max(0, m - 1))} disabled={monthOffset === 0}>
          <Icon name="chevronRight" size={16} className="rotate-180" /> Earlier
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setMonthOffset((m) => Math.min(22, m + 1))}>
          Later <Icon name="chevronRight" size={16} />
        </Button>
      </div>

      <div className="grid gap-8 md:grid-cols-2">
        {months.map((m) => (
          <div key={m.label}>
            <p className="mb-2 font-semibold">{m.label}</p>
            <div className="grid grid-cols-7 gap-1 text-center text-xs text-mist" aria-hidden>
              {["M", "T", "W", "T", "F", "S", "S"].map((d, i) => (
                <span key={i}>{d}</span>
              ))}
            </div>
            <div className="mt-1 grid grid-cols-7 gap-1">
              {m.cells.map((iso, i) => {
                if (!iso) return <span key={i} />;
                const past = iso < today;
                const isBooked = inRanges(booked, iso);
                const isBlocked = inRanges(blocked, iso);
                const label = `${new Intl.DateTimeFormat("en-AU", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).format(parseIsoDate(iso))}: ${isBooked ? "booked" : isBlocked ? "blocked" : "open"}`;
                return (
                  <button
                    key={iso}
                    type="button"
                    disabled={past || !editable}
                    onClick={() => pick(iso)}
                    aria-label={label}
                    aria-pressed={selected(iso)}
                    className={cn(
                      "grid aspect-square min-h-9 place-items-center rounded-lg text-sm font-medium transition-colors",
                      past && "text-ink/25",
                      !past && !isBlocked && !isBooked && "bg-white ring-1 ring-ink/10 hover:ring-ink/40",
                      isBlocked && !past && "bg-ink/70 text-white",
                      isBooked && !past && "bg-ochre-300 text-ink",
                      selected(iso) && "bg-eucalypt-600 text-white ring-0",
                    )}
                  >
                    {Number(iso.slice(8))}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {editable && (
        <form onSubmit={keepValuesOnSubmit(action)} className="space-y-4 rounded-2xl border border-ink/10 bg-white p-5">
          <input type="hidden" name="propertyId" value={propertyId} />
          <FormMessage state={state} />
          {state.ok && (
            <p role="status" className="text-sm font-semibold text-eucalypt-700">
              Calendar updated.
            </p>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <Input label="First night" name="start" type="date" min={today} value={start} onChange={(e) => setStart(e.target.value)} error={state.fieldErrors?.start} />
            <Input label="Check-out date (not included)" name="end" type="date" min={start || today} value={end} onChange={(e) => setEnd(e.target.value)} error={state.fieldErrors?.end} />
          </div>
          <div className="flex flex-wrap gap-3">
            <Button type="submit" name="mode" value="block" disabled={pending || !start || !end}>
              Block these dates
            </Button>
            <Button type="submit" name="mode" value="unblock" variant="outline" disabled={pending || !start || !end}>
              Make available
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}

function Legend({ className, label }: { className: string; label: string }) {
  return (
    <span className="flex items-center gap-2">
      <span className={cn("size-4 rounded", className)} aria-hidden />
      {label}
    </span>
  );
}

function monthGrid(year: number, monthIndex: number) {
  const first = new Date(Date.UTC(year, monthIndex, 1));
  const label = new Intl.DateTimeFormat("en-AU", { month: "long", year: "numeric", timeZone: "UTC" }).format(first);
  const leading = (first.getUTCDay() + 6) % 7; // Monday-first
  const days = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  const cells: (string | null)[] = Array.from({ length: leading }, () => null);
  for (let d = 1; d <= days; d++) cells.push(toIsoDate(new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), d))));
  return { label, cells };
}
