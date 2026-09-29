import "server-only";
import { addDays, blockRange, unblockRange, type DateRange } from "@/lib/date-ranges";
import { todayInTimeZone } from "@/lib/dates";
import { MAX_BLOCK_AHEAD_DAYS } from "@/lib/validation/host";
import { prisma } from "@/server/db";
import { loadEditableProperty, noteEdit, withSection, type HostResult } from "./host-access";
import { activeBookingWhere } from "./search-query";

/**
 * Host calendar. A property is open on every date unless blocked. Host blocks are stored as
 * merged, non-overlapping BlockedDate ranges (source HOST); blocks from other sources (admin, iCal)
 * are never touched here.
 *
 * Blocking is a host preference, separate from bookings: the database's booking-overlap
 * constraint is unaffected. A block may not cover dates that already have an active booking.
 */

type Change = { ok: true; value: undefined } | Exclude<HostResult, { ok: true }>;

async function validateRange(timezone: string, range: DateRange): Promise<Change> {
  const today = todayInTimeZone(timezone);
  if (range.start < today) return { ok: false, error: "invalid", message: "Dates in the past can't be changed.", fieldErrors: { start: "Choose today or a later date" } };
  if (range.end > addDays(today, MAX_BLOCK_AHEAD_DAYS)) {
    return { ok: false, error: "invalid", message: "You can manage dates up to two years ahead.", fieldErrors: { end: "Choose a date within two years" } };
  }
  return { ok: true, value: undefined };
}

async function applyRanges(propertyId: string, next: DateRange[]) {
  await prisma.$transaction([
    prisma.blockedDate.deleteMany({ where: { propertyId, source: "HOST" } }),
    prisma.blockedDate.createMany({ data: next.map((r) => ({ propertyId, startDate: r.start, endDate: r.end, source: "HOST" as const })) }),
  ]);
}

async function currentHostRanges(propertyId: string): Promise<DateRange[]> {
  const rows = await prisma.blockedDate.findMany({ where: { propertyId, source: "HOST" }, select: { startDate: true, endDate: true } });
  return rows.map((r) => ({ start: r.startDate, end: r.endDate }));
}

export async function setDatesBlocked(userId: string, propertyId: string, range: DateRange, blocked: boolean): Promise<Change> {
  const loaded = await loadEditableProperty(userId, propertyId);
  if (!loaded.ok) return loaded;
  const p = await prisma.property.findUniqueOrThrow({ where: { id: loaded.value.id }, select: { id: true, timezone: true, status: true, completedSections: true } });

  const valid = await validateRange(p.timezone, range);
  if (!valid.ok) return valid;

  if (blocked) {
    const clash = await prisma.booking.count({
      where: { propertyId: p.id, ...activeBookingWhere(), checkIn: { lt: range.end }, checkOut: { gt: range.start } },
    });
    if (clash > 0) return { ok: false, error: "conflict", message: "Some of those dates are already booked, so they can't be blocked." };
  }

  const current = await currentHostRanges(p.id);
  await applyRanges(p.id, blocked ? blockRange(current, range) : unblockRange(current, range));
  await prisma.property.update({ where: { id: p.id }, data: { completedSections: withSection(p.completedSections, "availability") } });
  await noteEdit(userId, p, "availability");
  return { ok: true, value: undefined };
}

/**
 * Mark a section as reviewed without changing data — e.g. the calendar ("open unless blocked" is
 * the default rule) or photos (which save on upload). Ownership and editability are still checked.
 */
export async function markSectionReviewed(userId: string, propertyId: string, section: "availability" | "photos"): Promise<Change> {
  const loaded = await loadEditableProperty(userId, propertyId);
  if (!loaded.ok) return loaded;
  await prisma.property.update({ where: { id: loaded.value.id }, data: { completedSections: withSection(loaded.value.completedSections, section) } });
  return { ok: true, value: undefined };
}
