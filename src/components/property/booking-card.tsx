import Link from "next/link";
import { buttonClasses } from "@/components/ui/button";
import { Card } from "@/components/ui/feedback";
import { Icon } from "@/components/ui/icons";
import { PriceBreakdown } from "@/components/ui/price-breakdown";
import { formatMoney } from "@/lib/money";
import { pluralize } from "@/lib/utils";
import { describeQuoteProblem, type StayQuoteResult } from "@/server/services/stay-quote";
import { StayQuoteForm } from "./stay-quote-form";

export interface BookingCardProps {
  slug: string;
  currency: string;
  nightlyPriceCents: number;
  weekendPriceCents: number | null;
  minNights: number;
  isDemo: boolean;
  today: string;
  selection: { checkIn?: string; checkOut?: string; adults: number; children: number };
  quote: StayQuoteResult | null;
  reserveHref: string | null;
}

/**
 * Booking *preview*. Shows an estimated price from server-side pricing; "Reserve" leads to a
 * preview page that states clearly that online booking isn't available yet. Nothing is booked,
 * held or charged.
 */
export function BookingCard(p: BookingCardProps) {
  const problem = p.quote && p.quote.status !== "ok" ? describeQuoteProblem(p.quote) : null;
  return (
    <Card className="p-6">
      <p className="text-2xl font-bold">
        {formatMoney(p.nightlyPriceCents, p.currency)}
        <span className="text-base font-normal text-mist"> / night</span>
      </p>
      {p.weekendPriceCents && p.weekendPriceCents !== p.nightlyPriceCents && (
        <p className="text-sm text-mist">{formatMoney(p.weekendPriceCents, p.currency)} Fri & Sat nights</p>
      )}
      {p.minNights > 1 && <p className="text-sm text-mist">{p.minNights}-night minimum stay</p>}

      <StayQuoteForm slug={p.slug} today={p.today} defaults={p.selection} />

      {problem && (
        <p className="mt-4 flex gap-2 rounded-xl bg-ochre-50 p-3 text-sm text-ochre-700" role="alert">
          <Icon name="alert" size={18} className="shrink-0" />
          {problem}
        </p>
      )}
      {p.quote?.status === "ok" && (
        <div className="mt-5">
          <PriceBreakdown quote={p.quote.quote} currency={p.currency} totalLabel="Estimated total" />
        </div>
      )}

      {p.reserveHref ? (
        <Link href={p.reserveHref} className={buttonClasses({ variant: "accent", size: "lg", className: "mt-5 w-full" })}>
          Reserve
        </Link>
      ) : (
        <button type="button" disabled className={buttonClasses({ variant: "accent", size: "lg", className: "mt-5 w-full" })} aria-describedby="reserve-note">
          Reserve
        </button>
      )}
      <p id="reserve-note" className="mt-2 text-center text-xs text-mist">
        {!p.selection.checkIn || !p.selection.checkOut
          ? "Choose dates to see your estimated total."
          : "Online booking is coming soon — you won't be charged."}
        {p.isDemo && " This is a demo listing."}
      </p>
    </Card>
  );
}

/** Mobile-only bottom bar so price and the next step are always reachable. */
export function MobileBookingBar(p: Pick<BookingCardProps, "currency" | "nightlyPriceCents" | "quote" | "reserveHref">) {
  const total = p.quote?.status === "ok" ? p.quote.quote : null;
  return (
    <div className="fixed inset-x-0 bottom-0 z-30 border-t border-ink/10 bg-white/95 px-4 py-3 backdrop-blur lg:hidden">
      <div className="mx-auto flex max-w-xl items-center justify-between gap-4">
        <p className="min-w-0">
          {total ? (
            <>
              <span className="font-bold">{formatMoney(total.guestTotalCents, p.currency)}</span>
              <span className="block text-xs text-mist">Estimated total · {pluralize(total.nights, "night")}</span>
            </>
          ) : (
            <>
              <span className="font-bold">{formatMoney(p.nightlyPriceCents, p.currency)}</span>
              <span className="text-sm text-mist"> / night</span>
            </>
          )}
        </p>
        {p.reserveHref ? (
          <Link href={p.reserveHref} className={buttonClasses({ variant: "accent", className: "shrink-0" })}>
            Reserve
          </Link>
        ) : (
          <a href="#booking" className={buttonClasses({ variant: "primary", className: "shrink-0" })}>
            Check dates
          </a>
        )}
      </div>
    </div>
  );
}
