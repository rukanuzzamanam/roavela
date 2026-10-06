"use server";

import { revalidatePath } from "next/cache";
import { gateAdminAction } from "@/server/auth/admin-guard";
import { createFeeSchedule } from "@/server/services/admin/commission";
import { parseVersion } from "@/server/services/admin/common";
import { cancelBookingAsAdmin, declineRefund, executeAdminRefund } from "@/server/services/admin/refunds";
import { reactivateAccount, suspendAccount } from "@/server/services/admin/users";
import { isPlausibleReference } from "@/lib/validation/booking";
import { denied, field, idField, toFormState, type AdminFormState } from "./admin-form";

/**
 * High-impact admin Server Actions: refunds, cancellations, account suspension and commission.
 * Money amounts from the form are re-validated (and, for policy refunds, ignored) by the services;
 * a one-time request key generated at page render makes refunds idempotent.
 */

function reference(fd: FormData): string | null {
  const r = field(fd, "reference").toUpperCase();
  return isPlausibleReference(r) ? r : null;
}

export async function executeRefundAction(_prev: AdminFormState, fd: FormData): Promise<AdminFormState> {
  const gate = await gateAdminAction("admin:refunds:manage", "adminRefund");
  if (!gate.ok) return denied(gate.error);
  const ref = reference(fd);
  if (!ref) return denied("Invalid request.");
  const result = await executeAdminRefund(gate.admin, { reference: ref, mode: field(fd, "mode"), amount: field(fd, "amount"), reason: field(fd, "reason"), requestKey: field(fd, "requestKey") });
  revalidatePath(`/admin/bookings/${ref}`);
  if (!result.ok) return toFormState(result, "");
  const v = result.value;
  return {
    ok: true,
    message: v.duplicate
      ? "This refund was already submitted — no second refund was made."
      : v.status === "SUCCEEDED"
        ? "TEST refund confirmed by the payment provider. The booking updates when the provider's refund event is processed."
        : "TEST refund requested. It shows as pending until the provider confirms it.",
    at: Date.now(),
  };
}

export async function declineRefundAction(_prev: AdminFormState, fd: FormData): Promise<AdminFormState> {
  const gate = await gateAdminAction("admin:refunds:manage", "adminRefund");
  if (!gate.ok) return denied(gate.error);
  const ref = reference(fd);
  if (!ref) return denied("Invalid request.");
  const result = await declineRefund(gate.admin, { reference: ref, reason: field(fd, "reason") });
  if (result.ok) revalidatePath(`/admin/bookings/${ref}`);
  return toFormState(result, "Refund declined and recorded. No money moved.");
}

export async function cancelBookingAction(_prev: AdminFormState, fd: FormData): Promise<AdminFormState> {
  const gate = await gateAdminAction("admin:bookings:manage", "adminRefund");
  if (!gate.ok) return denied(gate.error);
  const ref = reference(fd);
  if (!ref) return denied("Invalid request.");
  const result = await cancelBookingAsAdmin(gate.admin, {
    reference: ref,
    refundMode: field(fd, "refundMode"),
    reason: field(fd, "reason"),
    requestKey: field(fd, "requestKey"),
    expectedUpdatedAt: parseVersion(field(fd, "version")),
  });
  revalidatePath(`/admin/bookings/${ref}`);
  if (!result.ok) return toFormState(result, "");
  return {
    ok: true,
    message: result.value.refundError
      ? `Booking cancelled. ${result.value.refundError} It is listed in the refund queue for a retry.`
      : result.value.refundCents > 0
        ? "Booking cancelled and a TEST refund requested."
        : "Booking cancelled. No refund was due.",
    at: Date.now(),
  };
}

export async function suspendAccountAction(_prev: AdminFormState, fd: FormData): Promise<AdminFormState> {
  const gate = await gateAdminAction("admin:users:manage");
  if (!gate.ok) return denied(gate.error);
  const userId = idField(fd, "userId");
  if (!userId) return denied("Invalid request.");
  const result = await suspendAccount(gate.admin, { userId, reason: field(fd, "reason"), expectedUpdatedAt: parseVersion(field(fd, "version")) });
  revalidatePath("/admin/hosts");
  revalidatePath("/admin/customers");
  if (!result.ok) return toFormState(result, "");
  const { listingsSuspended, upcomingBookings } = result.value;
  return {
    ok: true,
    message: `Account suspended and signed out.${listingsSuspended ? ` ${listingsSuspended} listing(s) suspended.` : ""}${upcomingBookings ? ` ${upcomingBookings} upcoming confirmed booking(s) were kept and need admin handling.` : ""}`,
    at: Date.now(),
  };
}

export async function reactivateAccountAction(_prev: AdminFormState, fd: FormData): Promise<AdminFormState> {
  const gate = await gateAdminAction("admin:users:manage");
  if (!gate.ok) return denied(gate.error);
  const userId = idField(fd, "userId");
  if (!userId) return denied("Invalid request.");
  const result = await reactivateAccount(gate.admin, { userId, reason: field(fd, "reason"), expectedUpdatedAt: parseVersion(field(fd, "version")) });
  revalidatePath("/admin/hosts");
  revalidatePath("/admin/customers");
  if (!result.ok) return toFormState(result, "");
  return { ok: true, message: `Account reactivated.${result.value.listingsRestored ? ` ${result.value.listingsRestored} listing(s) restored as paused.` : ""}`, at: Date.now() };
}

const COMMISSION_FIELDS = ["name", "guestServiceFeeBps", "hostCommissionBps", "effectiveDate", "reason", "confirmed"] as const;

export async function createCommissionAction(_prev: AdminFormState, fd: FormData): Promise<AdminFormState> {
  const gate = await gateAdminAction("admin:commission:manage", "adminCommission");
  if (!gate.ok) return denied(gate.error);
  const values = Object.fromEntries(COMMISSION_FIELDS.map((k) => [k, field(fd, k)]));
  const result = await createFeeSchedule(gate.admin, values);
  if (result.ok) revalidatePath("/admin/commission");
  return toFormState(result, "Commission schedule created. Existing bookings keep their original rates.");
}
