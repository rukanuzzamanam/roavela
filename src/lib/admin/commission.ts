import { z } from "zod";
import { addDays, isIsoDate, parseIsoDate, todayInTimeZone, toIsoDate } from "@/lib/dates";
import { ADMIN_TIMEZONE, startOfDayIn } from "./ranges";

/**
 * Commission (fee schedule) rules. Schedules are immutable, versioned rows: a change is a NEW row
 * with a future effective date, never an edit. Bookings keep the rates snapshotted when they were
 * made, so a schedule change can't alter any existing booking's economics.
 *
 * Bounds are deliberately tighter than the database CHECK (0–50%): a typo like "120" for 12.0%
 * is rejected here before it can reach a quote.
 */
export const COMMISSION_BOUNDS = {
  guestServiceFeeBps: { min: 0, max: 2000 },
  hostCommissionBps: { min: 0, max: 2500 },
} as const;

/** How far ahead a schedule may be scheduled. */
export const MAX_SCHEDULE_AHEAD_DAYS = 365;

const PERCENT = /^\d{1,2}(\.\d{1,2})?$/;

/** "12.5" → 1250 bps. Integer arithmetic only — no float parsing. */
export function parsePercentToBps(value: string): number | null {
  const v = value.trim().replace(/%$/, "");
  if (!PERCENT.test(v)) return null;
  const [whole, frac = ""] = v.split(".");
  return Number(whole) * 100 + Number(frac.padEnd(2, "0"));
}

export function formatBps(bps: number): string {
  const whole = Math.floor(bps / 100);
  const frac = bps % 100;
  return frac === 0 ? `${whole}%` : `${whole}.${String(frac).padStart(2, "0").replace(/0$/, "")}%`;
}

const bps = (label: string, key: keyof typeof COMMISSION_BOUNDS) =>
  z
    .string()
    .trim()
    .transform((v, ctx) => {
      const parsed = parsePercentToBps(v);
      const { min, max } = COMMISSION_BOUNDS[key];
      if (parsed === null) {
        ctx.addIssue({ code: "custom", message: `Enter ${label.toLowerCase()} as a percentage, e.g. 12 or 12.5` });
        return z.NEVER;
      }
      if (parsed < min || parsed > max) {
        ctx.addIssue({ code: "custom", message: `${label} must be between ${formatBps(min)} and ${formatBps(max)}` });
        return z.NEVER;
      }
      return parsed;
    });

export const commissionScheduleSchema = z.object({
  name: z.string().trim().min(3, "Give the schedule a name").max(80),
  guestServiceFeeBps: bps("Guest service fee", "guestServiceFeeBps"),
  hostCommissionBps: bps("Host commission", "hostCommissionBps"),
  effectiveDate: z.string().trim().refine(isIsoDate, "Choose an effective date"),
  reason: z.string().trim().min(10, "Explain the change (at least 10 characters)").max(500),
  confirmed: z.literal("on", { message: "Confirm that you understand this affects new bookings" }),
});

export type EffectiveFromResult = { ok: true; effectiveFrom: Date } | { ok: false; error: string };

/**
 * Effective dates can't be in the past (no back-dating). "Today" takes effect immediately;
 * later dates take effect at local midnight in Roavela's operating timezone.
 */
export function resolveEffectiveFrom(isoDate: string, now = new Date()): EffectiveFromResult {
  const today = todayInTimeZone(ADMIN_TIMEZONE, now);
  const day = parseIsoDate(isoDate);
  if (day < today) return { ok: false, error: "The effective date can't be in the past." };
  if (day > addDays(today, MAX_SCHEDULE_AHEAD_DAYS)) return { ok: false, error: "Schedules can be set at most a year ahead." };
  return { ok: true, effectiveFrom: toIsoDate(day) === toIsoDate(today) ? now : startOfDayIn(isoDate) };
}

export type ScheduleState = "active" | "scheduled" | "superseded";

/**
 * State of each schedule in one country scope (null = global default), mirroring how
 * getActiveFeeSchedule picks the rate in force: the latest effectiveFrom ≤ now.
 */
export function scheduleStates<T extends { id: string; effectiveFrom: Date }>(schedules: readonly T[], now = new Date()): Map<string, ScheduleState> {
  const states = new Map<string, ScheduleState>();
  const started = schedules.filter((s) => s.effectiveFrom <= now).sort((a, b) => b.effectiveFrom.getTime() - a.effectiveFrom.getTime());
  for (const s of schedules) states.set(s.id, s.effectiveFrom > now ? "scheduled" : "superseded");
  if (started[0]) states.set(started[0].id, "active");
  return states;
}
