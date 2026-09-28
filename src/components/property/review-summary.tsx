import { Badge, Card, Rating } from "@/components/ui/feedback";
import { Icon } from "@/components/ui/icons";
import { pluralize } from "@/lib/utils";

interface ReviewItem {
  id: string;
  authorName: string;
  overallRating: number;
  body: string;
  createdAt: Date;
  isDemo: boolean;
}

/**
 * Reviews are read-only here. Submitting a review requires a COMPLETED booking and arrives with
 * the booking system — there is intentionally no "write a review" form yet.
 */
export function ReviewSummary({
  ratingAverage,
  reviewCount,
  categories,
  reviews,
}: {
  ratingAverage: number | null;
  reviewCount: number;
  categories: { key: string; label: string; value: number }[];
  reviews: ReviewItem[];
}) {
  const hasDemo = reviews.some((r) => r.isDemo);
  return (
    <div>
      <div className="flex flex-wrap items-center gap-3">
        {ratingAverage !== null && reviewCount > 0 ? (
          <p className="flex items-center gap-2 font-display text-3xl">
            <Icon name="star" size={26} className="fill-ochre-400 text-ochre-400" />
            {ratingAverage.toFixed(2)}
            <span className="font-sans text-base text-mist">· {pluralize(reviewCount, "review")}</span>
          </p>
        ) : (
          <p className="text-ink-soft">No reviews yet.</p>
        )}
        {hasDemo && <Badge tone="demo">Demo reviews — sample data</Badge>}
      </div>
      <p className="mt-1 text-sm text-mist">Only guests who completed a stay can leave a review.</p>

      {categories.length > 0 && (
        <dl className="mt-6 grid gap-x-10 gap-y-3 sm:grid-cols-2">
          {categories.map((c) => (
            <div key={c.key} className="flex items-center gap-3">
              <dt className="w-32 shrink-0 text-ink-soft">{c.label}</dt>
              <dd className="flex flex-1 items-center gap-3">
                <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-sand-200" aria-hidden>
                  <span className="block h-full rounded-full bg-eucalypt-600" style={{ width: `${(c.value / 5) * 100}%` }} />
                </span>
                <span className="w-8 text-right text-sm font-semibold tabular-nums">
                  {c.value.toFixed(1)}
                  <span className="sr-only"> out of 5</span>
                </span>
              </dd>
            </div>
          ))}
        </dl>
      )}

      {reviews.length > 0 && (
        <ul className="mt-8 grid gap-5 sm:grid-cols-2">
          {reviews.map((r) => (
            <li key={r.id}>
              <Card className="h-full p-5">
                <div className="flex items-center justify-between gap-2">
                  <p className="font-semibold">{r.authorName}</p>
                  <Rating value={r.overallRating} count={1} showCount={false} />
                </div>
                <p className="text-xs text-mist">
                  {new Intl.DateTimeFormat("en-AU", { month: "long", year: "numeric" }).format(r.createdAt)}
                  {r.isDemo && " · Demo review"}
                </p>
                <p className="mt-3 text-ink-soft">{r.body}</p>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
