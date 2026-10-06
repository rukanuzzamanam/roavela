import { addDays, isIsoDate, nightsBetween, parseIsoDate, todayInTimeZone, toIsoDate } from "@/lib/dates";

/**
 * Reporting date ranges for the admin dashboard. Ranges are whole calendar days in Roavela's
 * operating timezone and are half-open: [from, to). `from`/`to` are UTC instants at local midnight,
 * so they can be compared directly against timestamp columns (confirmedAt, createdAt …).
 */
export const ADMIN_TIMEZONE = "Australia/Sydney";
export const RANGE_PRESETS = ["7d", "30d", "this_month", "prev_month", "custom"] as const;
export type RangePreset = (typeof RANGE_PRESETS)[number];
export const MAX_CUSTOM_RANGE_DAYS = 366;

export interface DateRange {
  preset: RangePreset;
  /** Inclusive first day / inclusive last day, as ISO dates in ADMIN_TIMEZONE. */
  firstDay: string;
  lastDay: string;
  /** UTC instants: start of firstDay, start of the day after lastDay. */
  from: Date;
  to: Date;
  label: string;
  /** True when a requested custom range was invalid and the default was used instead. */
  invalid: boolean;
}

/** Offset (ms) of `timeZone` from UTC at a given instant. */
function zoneOffsetMs(timeZone: string, at: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(at);
  const n = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const asUtc = Date.UTC(n("year"), n("month") - 1, n("day"), n("hour"), n("minute"), n("second"));
  return asUtc - Math.floor(at.getTime() / 1000) * 1000;
}

/** The UTC instant of local midnight at the start of `isoDate` in `timeZone` (DST-safe). */
export function startOfDayIn(isoDate: string, timeZone = ADMIN_TIMEZONE): Date {
  const wall = parseIsoDate(isoDate).getTime();
  let guess = wall - zoneOffsetMs(timeZone, new Date(wall));
  // Re-evaluate once at the guessed instant in case a DST change sits between the two.
  guess = wall - zoneOffsetMs(timeZone, new Date(guess));
  return new Date(guess);
}

function monthStart(day: Date): Date {
  return new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), 1));
}

function build(preset: RangePreset, first: Date, last: Date, label: string, invalid = false): DateRange {
  const firstDay = toIsoDate(first);
  const lastDay = toIsoDate(last);
  return { preset, firstDay, lastDay, from: startOfDayIn(firstDay), to: startOfDayIn(toIsoDate(addDays(last, 1))), label, invalid };
}

/** Resolve dashboard query parameters into a validated range. Anything malformed falls back to 30 days. */
export function resolveRange(params: { range?: string; from?: string; to?: string }, now = new Date()): DateRange {
  const today = todayInTimeZone(ADMIN_TIMEZONE, now);
  const preset = (RANGE_PRESETS as readonly string[]).includes(params.range ?? "") ? (params.range as RangePreset) : "30d";
  switch (preset) {
    case "7d":
      return build("7d", addDays(today, -6), today, "Last 7 days");
    case "this_month":
      return build("this_month", monthStart(today), today, "This month");
    case "prev_month": {
      const thisMonth = monthStart(today);
      return build("prev_month", monthStart(addDays(thisMonth, -1)), addDays(thisMonth, -1), "Previous month");
    }
    case "custom": {
      const { from = "", to = "" } = params;
      if (isIsoDate(from) && isIsoDate(to)) {
        const first = parseIsoDate(from);
        const last = parseIsoDate(to);
        const span = nightsBetween(first, last) + 1;
        if (span >= 1 && span <= MAX_CUSTOM_RANGE_DAYS && last <= today) return build("custom", first, last, `${from} to ${to}`);
      }
      return { ...build("30d", addDays(today, -29), today, "Last 30 days"), invalid: true };
    }
    default:
      return build("30d", addDays(today, -29), today, "Last 30 days");
  }
}
