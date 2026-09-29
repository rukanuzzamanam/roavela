"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { authorize, AuthorizationError } from "@/server/auth/guards";
import { getRateLimiter, RATE_LIMITS } from "@/server/rate-limit";
import { createBookingHold } from "@/server/services/bookings";
import { cancelBookingAsGuest, preparePayment, simulateMockPayment, type PreparePaymentResult } from "@/server/services/checkout";

/**
 * Booking Server Actions. The acting user always comes from the session. Inputs are limited to
 * identifiers and the guest's choices; prices, fees, currency and status are never read from the
 * client — they are computed or decided by the booking services.
 */

async function currentBooker() {
  try {
    return await authorize("booking:create");
  } catch (e) {
    if (e instanceof AuthorizationError) return null;
    throw e;
  }
}

export interface ReserveState {
  error?: string;
}

/** "Continue to payment": price on the server, hold the dates, go to checkout. */
export async function reserveStay(_prev: ReserveState, formData: FormData): Promise<ReserveState> {
  const user = await currentBooker();
  if (!user) return { error: "Please log in with a traveller account to book." };

  const limit = await getRateLimiter().consume(`quote:${user.id}`, RATE_LIMITS.bookingQuote);
  if (!limit.success) return { error: "Too many booking attempts. Please wait a while and try again." };

  // Only these fields are read — anything else in the form (e.g. a tampered "totalCents") is ignored.
  const result = await createBookingHold(user, {
    propertyId: formData.get("propertyId"),
    checkIn: formData.get("checkIn"),
    checkOut: formData.get("checkOut"),
    adults: formData.get("adults"),
    children: formData.get("children") ?? 0,
  });
  if (!result.ok) return { error: result.error };
  redirect(`/checkout/${result.reference}`);
}

export async function startPayment(reference: string): Promise<PreparePaymentResult> {
  const user = await currentBooker();
  if (!user) return { ok: false, state: "not_found", error: "Please log in again." };
  const limit = await getRateLimiter().consume(`pay:${user.id}`, RATE_LIMITS.paymentIntent);
  if (!limit.success) return { ok: false, state: "not_payable", error: "Too many payment attempts. Please wait a while and try again." };
  return preparePayment(user.id, String(reference));
}

/** Development-only simulated provider outcome (refused unless the mock provider is active). */
export async function simulatePayment(reference: string, outcome: "succeeded" | "failed"): Promise<{ ok: boolean; error?: string }> {
  const user = await currentBooker();
  if (!user) return { ok: false, error: "Please log in again." };
  if (outcome !== "succeeded" && outcome !== "failed") return { ok: false, error: "Invalid outcome." };
  const limit = await getRateLimiter().consume(`pay:${user.id}`, RATE_LIMITS.paymentIntent);
  if (!limit.success) return { ok: false, error: "Too many payment attempts. Please wait a while and try again." };
  const result = await simulateMockPayment(user.id, String(reference), outcome);
  return result.ok ? { ok: true } : { ok: false, error: result.error };
}

export interface CancelState {
  ok?: boolean;
  error?: string;
}

export async function cancelBooking(_prev: CancelState, formData: FormData): Promise<CancelState> {
  const user = await currentBooker();
  if (!user) return { error: "Please log in again." };
  const limit = await getRateLimiter().consume(`cancel:${user.id}`, RATE_LIMITS.bookingCancel);
  if (!limit.success) return { error: "Too many attempts. Please wait a while and try again." };

  const reference = String(formData.get("reference") ?? "");
  const result = await cancelBookingAsGuest(user.id, reference);
  if (!result.ok) return { error: result.error };
  revalidatePath("/account/bookings");
  revalidatePath(`/account/bookings/${reference}`);
  return { ok: true };
}
