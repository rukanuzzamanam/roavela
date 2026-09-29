import "server-only";
import { formatStayDate } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { env } from "@/server/env";
import { errorFields, log } from "@/server/log";
import { getEmailProvider, type EmailMessage } from "@/server/providers/email";

/**
 * Booking notifications. Sent AFTER the database change commits and never inside a transaction;
 * a failed email is logged (reference only) and never rolls back or blocks a booking.
 * Hosts get the guest's first name only — contact details stay private in the MVP.
 */
interface BookingEmailData {
  reference: string;
  propertyTitle: string;
  checkIn: Date;
  checkOut: Date;
  nights: number;
  totalCents: number;
  currency: string;
}

const url = (path: string) => new URL(path, env().APP_URL).toString();
const stay = (b: BookingEmailData) => `${formatStayDate(b.checkIn)} → ${formatStayDate(b.checkOut)} (${b.nights} night${b.nights === 1 ? "" : "s"})`;
const TEST_NOTE = "This booking was made in Roavela's Stripe TEST MODE. No real money was charged.";

export function bookingConfirmedEmail(to: string, b: BookingEmailData): EmailMessage {
  return {
    to,
    subject: `Booking confirmed: ${b.propertyTitle} (${b.reference})`,
    text: [
      `Your stay at ${b.propertyTitle} is confirmed.`,
      `Reference: ${b.reference}`,
      `Dates: ${stay(b)}`,
      `Total paid: ${formatMoney(b.totalCents, b.currency, { showCents: true })} ${b.currency}`,
      `Details: ${url(`/account/bookings/${b.reference}`)}`,
      "",
      TEST_NOTE,
    ].join("\n"),
  };
}

export function paymentFailedEmail(to: string, b: BookingEmailData, expiresAt: Date | null): EmailMessage {
  return {
    to,
    subject: `Payment didn't go through (${b.reference})`,
    text: [
      `Your payment for ${b.propertyTitle} didn't go through, so the booking is NOT confirmed.`,
      expiresAt ? `You can try again until ${expiresAt.toISOString().slice(11, 16)} UTC: ${url(`/checkout/${b.reference}`)}` : "",
      "You have not been charged for this attempt.",
      "",
      TEST_NOTE,
    ].filter(Boolean).join("\n"),
  };
}

export function bookingCancelledEmail(to: string, b: BookingEmailData, refundCents: number): EmailMessage {
  return {
    to,
    subject: `Booking cancelled: ${b.propertyTitle} (${b.reference})`,
    text: [
      `Your booking ${b.reference} at ${b.propertyTitle} (${stay(b)}) has been cancelled.`,
      refundCents > 0
        ? `A refund of ${formatMoney(refundCents, b.currency, { showCents: true })} ${b.currency} has been requested. It is shown as pending until the payment provider confirms it.`
        : "Under the booking's cancellation policy, no refund is due.",
      "",
      TEST_NOTE,
    ].join("\n"),
  };
}

export function hostNewBookingEmail(to: string, b: BookingEmailData & { hostPayoutCents: number; guestFirstName: string; guests: number }): EmailMessage {
  return {
    to,
    subject: `New booking: ${b.propertyTitle} (${b.reference})`,
    text: [
      `${b.guestFirstName} booked ${b.propertyTitle}.`,
      `Dates: ${stay(b)} · ${b.guests} guest${b.guests === 1 ? "" : "s"}`,
      `Your estimated proceeds: ${formatMoney(b.hostPayoutCents, b.currency, { showCents: true })} ${b.currency} (before payment-processing costs; payouts aren't enabled yet).`,
      `Details: ${url(`/host/bookings/${b.reference}`)}`,
      "",
      TEST_NOTE,
    ].join("\n"),
  };
}

export async function sendBookingEmail(kind: string, reference: string, message: EmailMessage): Promise<void> {
  try {
    await getEmailProvider().send(message);
    log.info("email.sent", { kind, reference });
  } catch (e) {
    log.error("email.failed", { kind, reference, ...errorFields(e) });
  }
}
