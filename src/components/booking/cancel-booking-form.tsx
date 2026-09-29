"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icons";
import { cancelBooking, type CancelState } from "@/server/actions/bookings";

/**
 * Two-step cancel (no browser dialogs). The refund shown is a preview; the server recalculates it
 * from the booking's policy snapshot when the cancellation is submitted.
 */
export function CancelBookingForm({ reference, refundLabel, explanation }: { reference: string; refundLabel: string; explanation: string }) {
  const [state, action, pending] = useActionState<CancelState, FormData>(cancelBooking, {});
  const [confirming, setConfirming] = useState(false);

  if (state.ok) {
    return (
      <p role="status" className="rounded-xl bg-eucalypt-50 p-3 text-sm text-eucalypt-800">
        Booking cancelled.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-ink-soft">{explanation}</p>
      <p className="text-sm">
        Refund if you cancel now: <strong>{refundLabel}</strong>
      </p>
      {state.error && (
        <p role="alert" className="flex gap-2 rounded-xl bg-ochre-50 p-3 text-sm text-ochre-700">
          <Icon name="alert" size={18} className="shrink-0" />
          {state.error}
        </p>
      )}
      {!confirming ? (
        <Button variant="outline" onClick={() => setConfirming(true)}>
          Cancel booking
        </Button>
      ) : (
        <form action={action} className="flex flex-wrap gap-2">
          <input type="hidden" name="reference" value={reference} />
          <Button type="submit" variant="primary" disabled={pending} aria-busy={pending} className="bg-red-700 hover:bg-red-800">
            {pending ? "Cancelling…" : "Yes, cancel this booking"}
          </Button>
          <Button variant="ghost" onClick={() => setConfirming(false)} disabled={pending}>
            Keep booking
          </Button>
        </form>
      )}
    </div>
  );
}
