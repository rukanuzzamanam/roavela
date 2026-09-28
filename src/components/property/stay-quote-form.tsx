"use client";

import Form from "next/form";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/field";
import { GuestSelector } from "@/components/ui/guest-selector";

/** Date/guest picker on the property page. Submits via GET so the server recomputes the quote. */
export function StayQuoteForm({
  slug,
  today,
  defaults,
}: {
  slug: string;
  today: string;
  defaults: { checkIn?: string; checkOut?: string; adults: number; children: number };
}) {
  const [checkIn, setCheckIn] = useState(defaults.checkIn ?? "");
  const [checkOut, setCheckOut] = useState(defaults.checkOut ?? "");

  return (
    <Form action={`/stays/${slug}`} scroll={false} className="mt-5 space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <DatePicker
          label="Check-in"
          name="checkIn"
          min={today}
          value={checkIn}
          onChange={(e) => {
            setCheckIn(e.target.value);
            if (checkOut && checkOut <= e.target.value) setCheckOut("");
          }}
        />
        <DatePicker label="Check-out" name="checkOut" min={checkIn || today} value={checkOut} onChange={(e) => setCheckOut(e.target.value)} />
      </div>
      <GuestSelector defaultAdults={defaults.adults} defaultChildren={defaults.children} />
      <Button type="submit" variant="outline" className="w-full">
        Check price
      </Button>
    </Form>
  );
}
