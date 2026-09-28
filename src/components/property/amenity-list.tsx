import { Icon } from "@/components/ui/icons";
import { AMENITY_BY_KEY, AMENITY_CATEGORY_LABELS, AMENITY_CATEGORY_ORDER } from "@/config/amenities";
import type { AmenityCategory } from "@/generated/prisma/enums";

export interface AmenityItem {
  key: string;
  label: string;
  category: AmenityCategory;
}

function AmenityRow({ a }: { a: AmenityItem }) {
  return (
    <li className="flex items-center gap-3 py-1">
      <Icon name={AMENITY_BY_KEY.get(a.key)?.icon ?? "check"} size={20} className="shrink-0 text-eucalypt-600" />
      {a.label}
    </li>
  );
}

/**
 * Amenities from the property's database records (never hard-coded per page). Shows a short list,
 * with the full set grouped by category behind a native disclosure — works without JavaScript.
 */
export function AmenityList({ amenities, preview = 8 }: { amenities: AmenityItem[]; preview?: number }) {
  if (amenities.length === 0) return <p className="text-ink-soft">The host hasn&apos;t listed amenities yet.</p>;

  const grouped = AMENITY_CATEGORY_ORDER.map((category) => ({
    category,
    items: amenities.filter((a) => a.category === category),
  })).filter((g) => g.items.length > 0);

  return (
    <div>
      <ul className="grid gap-x-8 gap-y-2 sm:grid-cols-2">
        {amenities.slice(0, preview).map((a) => (
          <AmenityRow key={a.key} a={a} />
        ))}
      </ul>
      {amenities.length > preview && (
        <details className="group mt-5">
          <summary className="inline-flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-full border border-ink/20 px-5 font-semibold hover:border-ink/40 [&::-webkit-details-marker]:hidden">
            <span className="group-open:hidden">Show all {amenities.length} amenities</span>
            <span className="hidden group-open:inline">Show fewer</span>
            <Icon name="chevronDown" size={16} className="transition-transform group-open:rotate-180" />
          </summary>
          <div className="mt-6 space-y-6">
            {grouped.map((g) => (
              <section key={g.category} aria-labelledby={`amenity-${g.category}`}>
                <h3 id={`amenity-${g.category}`} className="mb-2 font-sans text-sm font-bold tracking-wider text-mist uppercase">
                  {AMENITY_CATEGORY_LABELS[g.category]}
                </h3>
                <ul className="grid gap-x-8 gap-y-1 sm:grid-cols-2">
                  {g.items.map((a) => (
                    <AmenityRow key={a.key} a={a} />
                  ))}
                </ul>
              </section>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}
