"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icons";
import { reserveStay, type ReserveState } from "@/server/actions/bookings";

/**
 * Posts only the guest's choices. The server re-validates them, prices the stay itself and holds
 * the dates; a price in this form would simply be ignored.
 */
export function ReserveForm({ propertyId, checkIn, checkOut, adults, childCount }: { propertyId: string; checkIn: string; checkOut: string; adults: number; childCount: number }) {
  const [state, action, pending] = useActionState<ReserveState, FormData>(reserveStay, {});
  return (
    <form action={action} className="mt-5">
      <input type="hidden" name="propertyId" value={propertyId} />
      <input type="hidden" name="checkIn" value={checkIn} />
      <input type="hidden" name="checkOut" value={checkOut} />
      <input type="hidden" name="adults" value={adults} />
      <input type="hidden" name="children" value={childCount} />
      {state.error && (
        <p role="alert" className="mb-3 flex gap-2 rounded-xl bg-ochre-50 p-3 text-sm text-ochre-700">
          <Icon name="alert" size={18} className="shrink-0" />
          {state.error}
        </p>
      )}
      <Button type="submit" variant="accent" size="lg" className="w-full" disabled={pending} aria-busy={pending}>
        {pending ? "Holding your dates…" : "Continue to payment"}
      </Button>
    </form>
  );
}
