import { formatMoney } from "@/lib/money";
import type { StayQuote } from "@/lib/pricing";
import { pluralize } from "@/lib/utils";

/** Guest-facing price breakdown. Shows only what the guest pays — host commission is never displayed here. */
export function PriceBreakdown({ quote, currency, totalLabel = "Total" }: { quote: StayQuote; currency: string; totalLabel?: string }) {
  const rates = new Set(quote.nightlyRates.map((n) => n.cents));
  const rows = [
    {
      label: `Accommodation (${pluralize(quote.nights, "night")})`,
      detail: rates.size > 1 ? "Includes weekend or special-date rates" : `${formatMoney(quote.nightlyRates[0]?.cents ?? 0, currency)} per night`,
      value: quote.accommodationCents,
    },
    ...(quote.cleaningFeeCents > 0 ? [{ label: "Cleaning fee", detail: undefined, value: quote.cleaningFeeCents }] : []),
    { label: "Roavela service fee", detail: undefined, value: quote.guestServiceFeeCents },
  ];
  const money = (v: number) => formatMoney(v, currency, { showCents: v % 100 !== 0 });
  return (
    <dl className="space-y-2.5 text-[0.9375rem]">
      {rows.map((row) => (
        <div key={row.label} className="flex justify-between gap-4 text-ink-soft">
          <dt>
            {row.label}
            {row.detail && <span className="block text-xs text-mist">{row.detail}</span>}
          </dt>
          <dd className="tabular-nums">{money(row.value)}</dd>
        </div>
      ))}
      <div className="flex justify-between gap-4 border-t border-ink/10 pt-3 text-base font-bold">
        <dt>
          {totalLabel} ({currency})
        </dt>
        <dd className="tabular-nums">{money(quote.guestTotalCents)}</dd>
      </div>
    </dl>
  );
}
