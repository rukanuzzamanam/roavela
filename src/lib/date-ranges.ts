import { addDays } from "./dates";

/**
 * Pure helpers for editing blocked date ranges. Ranges are half-open [start, end) at UTC midnight,
 * matching BlockedDate (endDate exclusive).
 */
export interface DateRange {
  start: Date;
  end: Date;
}

const t = (d: Date) => d.getTime();

/** Merge overlapping or touching ranges and sort them. */
export function normaliseRanges(ranges: DateRange[]): DateRange[] {
  const sorted = ranges.filter((r) => t(r.end) > t(r.start)).sort((a, b) => t(a.start) - t(b.start));
  const out: DateRange[] = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    if (last && t(r.start) <= t(last.end)) {
      if (t(r.end) > t(last.end)) last.end = r.end;
    } else {
      out.push({ start: r.start, end: r.end });
    }
  }
  return out;
}

/** Add [start, end) to the blocked set. */
export function blockRange(ranges: DateRange[], add: DateRange): DateRange[] {
  return normaliseRanges([...ranges, add]);
}

/** Remove [start, end) from the blocked set, splitting ranges as needed. */
export function unblockRange(ranges: DateRange[], remove: DateRange): DateRange[] {
  const out: DateRange[] = [];
  for (const r of normaliseRanges(ranges)) {
    if (t(remove.end) <= t(r.start) || t(remove.start) >= t(r.end)) {
      out.push(r);
      continue;
    }
    if (t(r.start) < t(remove.start)) out.push({ start: r.start, end: remove.start });
    if (t(remove.end) < t(r.end)) out.push({ start: remove.end, end: r.end });
  }
  return out;
}

export function nightsInRanges(ranges: DateRange[]): number {
  return normaliseRanges(ranges).reduce((n, r) => n + Math.round((t(r.end) - t(r.start)) / 86_400_000), 0);
}

export function isNightBlocked(ranges: DateRange[], night: Date): boolean {
  return ranges.some((r) => t(night) >= t(r.start) && t(night) < t(r.end));
}

export { addDays };
