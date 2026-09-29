import { z } from "zod";
import { MAX_GUESTS } from "@/config/search";
import { isIsoDate } from "@/lib/dates";

/** Currencies the booking engine can charge in. Every booking stores its currency explicitly. */
export const SUPPORTED_CURRENCIES = ["AUD"] as const;
/** How far ahead a stay can be booked. */
export const MAX_BOOKING_HORIZON_DAYS = 730;

const isoDate = z.string().refine(isIsoDate, "Invalid date");

/**
 * The ONLY fields a booking request may carry. Unknown keys (e.g. "totalCents", "status",
 * "hostCommissionBps") are stripped by the schema and never reach the database.
 */
export const bookingRequestSchema = z.object({
  propertyId: z.string().trim().min(1).max(64),
  checkIn: isoDate,
  checkOut: isoDate,
  adults: z.coerce.number().int().min(1).max(MAX_GUESTS),
  children: z.coerce.number().int().min(0).max(MAX_GUESTS).default(0),
});
export type BookingRequest = z.infer<typeof bookingRequestSchema>;

const REFERENCE_SHAPE = /^[A-Z0-9-]{4,32}$/;
/** Cheap shape check before a lookup (current refs are ROA-XXXXXX; seeded demo refs differ). */
export const isPlausibleReference = (reference: string) => REFERENCE_SHAPE.test(reference);

export type BookingTab = "upcoming" | "past" | "cancelled";

export function bookingTab(b: { status: string; checkOut: Date; expiresAt: Date | null }, today: Date, now = new Date()): BookingTab | null {
  switch (b.status) {
    case "PENDING":
      return b.expiresAt && b.expiresAt > now ? "upcoming" : "cancelled";
    case "CONFIRMED":
      return b.checkOut > today ? "upcoming" : "past";
    case "COMPLETED":
      return "past";
    default:
      return "cancelled";
  }
}

/** Guest details a host may see in the MVP: first name and party size. No email/phone/surname. */
export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] || "Guest";
}
