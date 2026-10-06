import "server-only";
import { formatMoney } from "@/lib/money";
import { env } from "@/server/env";
import { errorFields, log } from "@/server/log";
import { getEmailProvider, type EmailMessage } from "@/server/providers/email";

/**
 * Notifications triggered by admin decisions. Sent AFTER the database transaction commits; a
 * failed email is logged (kind + target id only) and never undoes or blocks the decision.
 * Only host/customer-facing text goes into these messages — never internal admin notes.
 */
const url = (path: string) => new URL(path, env().APP_URL).toString();

export const listingApprovedEmail = (to: string, title: string, propertyId: string): EmailMessage => ({
  to,
  subject: `Your listing is live: ${title}`,
  text: [`Good news — ${title} has been approved and is now visible to guests.`, `Manage it: ${url(`/host/properties/${propertyId}`)}`].join("\n"),
});

export const listingChangesRequestedEmail = (to: string, title: string, propertyId: string, message: string): EmailMessage => ({
  to,
  subject: `Changes requested: ${title}`,
  text: [`Our review team asked for some changes to ${title} before it can go live.`, "", message, "", `Update and resubmit: ${url(`/host/properties/${propertyId}`)}`].join("\n"),
});

export const listingRejectedEmail = (to: string, title: string, propertyId: string, message: string): EmailMessage => ({
  to,
  subject: `Listing not approved: ${title}`,
  text: [`${title} wasn't approved.`, "", message, "", `Details: ${url(`/host/properties/${propertyId}`)}`].join("\n"),
});

export const listingSuspendedEmail = (to: string, title: string, message: string): EmailMessage => ({
  to,
  subject: `Listing suspended: ${title}`,
  text: [`${title} has been suspended and is no longer visible to guests.`, "", message, "", "Existing confirmed bookings are not cancelled automatically. Contact Roavela support with any questions."].join("\n"),
});

export const accountSuspendedEmail = (to: string, message: string): EmailMessage => ({
  to,
  subject: "Your Roavela account has been suspended",
  text: [`Your Roavela account has been suspended.`, "", message, "", "Your booking history is kept. Contact Roavela support if you believe this is a mistake."].join("\n"),
});

export const accountReactivatedEmail = (to: string): EmailMessage => ({
  to,
  subject: "Your Roavela account has been reactivated",
  text: [`Your Roavela account is active again. You can log in at ${url("/login")}.`].join("\n"),
});

export const bookingCancelledByRoavelaEmail = (to: string, reference: string, title: string, refundCents: number, currency: string): EmailMessage => ({
  to,
  subject: `Booking cancelled: ${title} (${reference})`,
  text: [
    `Roavela has cancelled booking ${reference} at ${title}.`,
    refundCents > 0
      ? `A refund of ${formatMoney(refundCents, currency, { showCents: true })} ${currency} has been requested. It shows as pending until the payment provider confirms it.`
      : "No refund is due for this booking.",
    "",
    "This booking was made in Roavela's Stripe TEST MODE. No real money was charged.",
  ].join("\n"),
});

export const refundRequestedEmail = (to: string, reference: string, refundCents: number, currency: string): EmailMessage => ({
  to,
  subject: `Refund requested for booking ${reference}`,
  text: [
    `A refund of ${formatMoney(refundCents, currency, { showCents: true })} ${currency} for booking ${reference} has been requested from our payment provider.`,
    "It shows as pending until the provider confirms it.",
    "",
    "This booking was made in Roavela's Stripe TEST MODE. No real money was charged.",
  ].join("\n"),
});

export async function sendAdminEmail(kind: string, targetId: string, message: EmailMessage): Promise<void> {
  try {
    await getEmailProvider().send(message);
    log.info("email.sent", { kind, targetId });
  } catch (e) {
    log.error("email.failed", { kind, targetId, ...errorFields(e) });
  }
}
