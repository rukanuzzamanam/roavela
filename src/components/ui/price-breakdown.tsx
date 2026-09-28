import { formatMoney } from "@/lib/money";
import type { StayQuote } from "@/lib/pricing";
import { pluralize } from "@/lib/utils";

/** Guest-facing price breakdown. Shows only what the guest pays — host commission is never displayed here. */
export function PriceBreakdown({ quote, currency }: { quote: StayQuote; currency: string }) {
  const avg = Math.round(quote.accommodationCents / quote.nights);
  const rows = [
    { label: `${formatMoney(avg, currency)} × ${pluralize(quote.nights, "night")}`, value: quote.accommodationCents },
    ...(quote.cleaningFeeCents > 0 ? [{ label: "Cleaning fee", value: quote.cleaningFeeCents }] : []),
    { label: "Roavela service fee", value: quote.guestServiceFeeCents },
  ];
  return (
    <dl className="space-y-2.5 text-[0.9375rem]">
      {rows.map((row) => (
        <div key={row.label} className="flex justify-between gap-4 text-ink-soft">
          <dt>{row.label}</dt>
          <dd className="tabular-nums">{formatMoney(row.value, currency, { showCents: row.value % 100 !== 0 })}</dd>
        </div>
      ))}
      <div className="flex justify-between gap-4 border-t border-ink/10 pt-3 text-base font-bold">
        <dt>Total ({currency})</dt>
        <dd className="tabular-nums">{formatMoney(quote.guestTotalCents, currency, { showCents: quote.guestTotalCents % 100 !== 0 })}</dd>
      </div>
    </dl>
  );
}
