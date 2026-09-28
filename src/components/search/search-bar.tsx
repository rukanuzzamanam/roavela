"use client";

import Form from "next/form";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { DatePicker, Select } from "@/components/ui/field";
import { GuestSelector } from "@/components/ui/guest-selector";
import { Icon } from "@/components/ui/icons";
import { DRIVE_TIME_OPTIONS } from "@/config/search";
import { cn } from "@/lib/utils";
import type { OriginOption } from "@/types/marketplace";

export interface SearchBarDefaults {
  from?: string;
  drive?: number;
  checkIn?: string;
  checkOut?: string;
  adults?: number;
  children?: number;
  maxPrice?: number;
  to?: string;
}

const BUDGETS = [150, 200, 250, 300, 400, 500, 750];

export function SearchBar({
  origins,
  defaults = {},
  today,
  variant = "hero",
}: {
  origins: OriginOption[];
  defaults?: SearchBarDefaults;
  /** Today's date (ISO) in the marketplace timezone, computed on the server. */
  today: string;
  variant?: "hero" | "compact";
}) {
  const [checkIn, setCheckIn] = useState(defaults.checkIn ?? "");
  const [checkOut, setCheckOut] = useState(defaults.checkOut ?? "");

  function onCheckInChange(value: string) {
    setCheckIn(value);
    // Keep the range valid: push check-out forward if it would be on/before check-in.
    if (value && checkOut && checkOut <= value) setCheckOut("");
  }

  const hero = variant === "hero";

  return (
    <Form
      action="/search"
      role="search"
      aria-label="Find a stay"
      className={cn(
        "grid gap-4 rounded-[1.75rem] bg-white p-4 sm:p-5",
        hero ? "shadow-float sm:grid-cols-2 lg:grid-cols-[1.1fr_1fr_1.5fr_1.2fr_1fr_auto] lg:items-end" : "border border-ink/10 sm:grid-cols-2 lg:grid-cols-6 lg:items-end",
      )}
    >
      {defaults.to && <input type="hidden" name="to" value={defaults.to} />}

      <Select label="Starting from" name="from" defaultValue={defaults.from ?? origins[0]?.slug}>
        {origins.map((o) => (
          <option key={o.slug} value={o.slug}>
            {o.name}
          </option>
        ))}
      </Select>

      <Select label="Maximum drive" name="drive" defaultValue={defaults.drive?.toString() ?? "3"}>
        <option value="">Any distance</option>
        {DRIVE_TIME_OPTIONS.map((h) => (
          <option key={h} value={h}>
            Up to {h} {h === 1 ? "hour" : "hours"}
          </option>
        ))}
      </Select>

      <fieldset className="grid grid-cols-2 gap-2 sm:col-span-2 lg:col-span-1">
        <legend className="sr-only">Dates</legend>
        <DatePicker label="Check-in" name="checkIn" min={today} value={checkIn} onChange={(e) => onCheckInChange(e.target.value)} />
        <DatePicker label="Check-out" name="checkOut" min={checkIn || today} value={checkOut} onChange={(e) => setCheckOut(e.target.value)} />
      </fieldset>

      <GuestSelector defaultAdults={defaults.adults} defaultChildren={defaults.children} />

      <Select label="Budget per night" name="maxPrice" defaultValue={defaults.maxPrice?.toString() ?? ""}>
        <option value="">Any price (optional)</option>
        {BUDGETS.map((b) => (
          <option key={b} value={b}>
            Up to ${b}
          </option>
        ))}
      </Select>

      <Button type="submit" variant="accent" size="lg" className={cn("w-full sm:col-span-2 lg:col-span-1", hero && "lg:mb-0")}>
        <Icon name="search" size={18} />
        {hero ? "Find my escape" : "Search"}
      </Button>
    </Form>
  );
}
