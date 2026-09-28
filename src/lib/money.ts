/** All monetary amounts in Roavela are integer minor units (e.g. cents). */
export type Cents = number;

export function formatMoney(
  cents: Cents,
  currency = "AUD",
  { locale = "en-AU", showCents = false }: { locale?: string; showCents?: boolean } = {},
): string {
  const hasFraction = cents % 100 !== 0;
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    currencyDisplay: "narrowSymbol",
    minimumFractionDigits: showCents || hasFraction ? 2 : 0,
    maximumFractionDigits: showCents || hasFraction ? 2 : 0,
  }).format(cents / 100);
}

/** Convert a whole-currency-unit value (e.g. dollars from a form) to minor units. */
export function toCents(amount: number): Cents {
  return Math.round(amount * 100);
}
