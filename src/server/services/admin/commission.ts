import "server-only";
import { commissionScheduleSchema, resolveEffectiveFrom, scheduleStates } from "@/lib/admin/commission";
import { prisma } from "@/server/db";
import { track } from "@/server/providers/analytics";
import { FORBIDDEN, fail, ok, permitted, recordAdminAction, type AdminActor, type AdminResult } from "./common";

/**
 * Commission (PlatformFeeSchedule) management. Schedules are append-only versions: a change creates
 * a new row that takes effect from its effective date. No existing schedule row is ever edited and
 * no booking is ever re-priced — every booking keeps the fee rates and schedule id snapshotted when
 * it was made. Only the global (all-countries) schedule is managed here.
 */
export async function listFeeSchedules(now = new Date()) {
  const rows = await prisma.platformFeeSchedule.findMany({
    orderBy: [{ effectiveFrom: "desc" }, { createdAt: "desc" }],
    take: 100,
    select: { id: true, name: true, countryCode: true, guestServiceFeeBps: true, hostCommissionBps: true, effectiveFrom: true, createdAt: true, createdBy: { select: { name: true } }, _count: { select: { bookings: true } } },
  });
  const states = new Map<string, ReturnType<typeof scheduleStates> extends Map<string, infer S> ? S : never>();
  for (const scope of new Set(rows.map((r) => r.countryCode))) {
    for (const [id, s] of scheduleStates(rows.filter((r) => r.countryCode === scope), now)) states.set(id, s);
  }
  return rows.map((r) => ({ ...r, state: states.get(r.id) ?? "superseded" }));
}

export async function createFeeSchedule(actor: AdminActor, values: Record<string, unknown>, now = new Date()): Promise<AdminResult<{ id: string }> & { fieldErrors?: Record<string, string> }> {
  if (!permitted(actor, "admin:commission:manage")) return FORBIDDEN();
  const parsed = commissionScheduleSchema.safeParse(values);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const i of parsed.error.issues) fieldErrors[String(i.path[0])] ??= i.message;
    return { ...fail("invalid", "Please fix the highlighted fields."), fieldErrors };
  }
  const effective = resolveEffectiveFrom(parsed.data.effectiveDate, now);
  if (!effective.ok) return { ...fail("invalid", effective.error), fieldErrors: { effectiveDate: effective.error } };
  const { name, guestServiceFeeBps, hostCommissionBps, reason } = parsed.data;

  const created = await prisma.$transaction(async (tx) => {
    const previous = await tx.platformFeeSchedule.findFirst({
      where: { countryCode: null, effectiveFrom: { lte: now } },
      orderBy: { effectiveFrom: "desc" },
      select: { id: true, guestServiceFeeBps: true, hostCommissionBps: true },
    });
    const row = await tx.platformFeeSchedule.create({
      data: { name, countryCode: null, guestServiceFeeBps, hostCommissionBps, effectiveFrom: effective.effectiveFrom, createdById: actor.id },
      select: { id: true },
    });
    await recordAdminAction(tx, {
      adminId: actor.id,
      action: "commission.schedule_created",
      targetType: "PlatformFeeSchedule",
      targetId: row.id,
      reason,
      metadata: { guestServiceFeeBps, hostCommissionBps, effectiveFrom: effective.effectiveFrom.toISOString(), previous: previous ?? null },
    });
    return row;
  });
  track({ name: "commission_schedule_created", properties: { scheduleId: created.id } });
  return ok({ id: created.id });
}
