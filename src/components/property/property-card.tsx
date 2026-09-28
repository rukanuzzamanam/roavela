import Link from "next/link";
import { Badge, Rating } from "@/components/ui/feedback";
import { Icon } from "@/components/ui/icons";
import { PROPERTY_TYPE_LABELS } from "@/config/search";
import { formatDriveTime } from "@/lib/geo";
import { formatMoney } from "@/lib/money";
import { cn, pluralize } from "@/lib/utils";
import type { PropertyCardData } from "@/types/marketplace";
import { FavouriteButton } from "./favourite-button";
import { PropertyImage } from "./property-image";

export function PropertyCard({
  property: p,
  query,
  className,
  priority,
}: {
  property: PropertyCardData;
  /** Search query to carry dates/guests through to the property page. */
  query?: string;
  className?: string;
  priority?: boolean;
}) {
  const href = `/stays/${p.slug}${query ? `?${query}` : ""}`;
  return (
    <article className={cn("group relative flex flex-col", className)}>
      <div className="relative">
        <PropertyImage src={p.imageUrl} alt={p.imageAlt} priority={priority} className="aspect-[4/3] rounded-[var(--radius-card)]" />
        <div className="absolute inset-x-3 top-3 flex items-start justify-between gap-2">
          <div className="flex flex-wrap gap-1.5">
            {p.drive && (
              <Badge className="bg-white/95 text-ink shadow-card">
                <Icon name="car" size={14} />
                {formatDriveTime(p.drive.durationMinutes)}
              </Badge>
            )}
            {p.isDemo && <Badge tone="demo">Demo listing</Badge>}
          </div>
          {/* Positioned above the stretched link so it stays independently clickable. */}
          <FavouriteButton propertyId={p.id} propertyTitle={p.title} initialSaved={p.isFavourite} className="relative z-10" />
        </div>
      </div>

      <div className="mt-3 flex flex-1 flex-col gap-1 px-0.5">
        <div className="flex items-start justify-between gap-3">
          <p className="text-xs font-bold tracking-wider text-eucalypt-600 uppercase">
            {p.destinationName} · {PROPERTY_TYPE_LABELS[p.type]}
          </p>
          <Rating value={p.ratingAverage} count={p.reviewCount} className="shrink-0" />
        </div>
        <h3 className="font-display text-xl leading-tight">
          <Link href={href} className="after:absolute after:inset-0 after:content-[''] focus-visible:outline-none">
            {p.title}
          </Link>
        </h3>
        {p.drive && (
          <p className="text-sm text-ink-soft">
            {formatDriveTime(p.drive.durationMinutes)} from {p.drive.originName}
            {p.drive.approximate && <span className="text-mist"> (approx.)</span>}
          </p>
        )}
        <p className="text-sm text-mist">
          Sleeps {p.maxGuests} · {pluralize(p.bedrooms, "bedroom")} · {pluralize(p.bathrooms, "bath")}
        </p>
        {p.highlights.length > 0 && (
          <ul className="mt-1 flex flex-wrap gap-1.5" aria-label="Highlights">
            {p.highlights.map((h) => (
              <li key={h.key} className="rounded-full bg-sand-100 px-2.5 py-0.5 text-xs font-medium text-ink-soft">
                {h.label}
              </li>
            ))}
          </ul>
        )}
        <p className="mt-auto pt-2 text-[0.9375rem]">
          <span className="font-bold">{formatMoney(p.nightlyPriceCents, p.currency)}</span>
          <span className="text-mist"> / night</span>
          {p.stay && (
            <span className="text-mist">
              {" "}
              · <span className="font-semibold text-ink">{formatMoney(p.stay.totalCents, p.currency)}</span> total for{" "}
              {pluralize(p.stay.nights, "night")}
            </span>
          )}
        </p>
      </div>
    </article>
  );
}
