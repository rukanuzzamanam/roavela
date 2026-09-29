import { PropertyImage } from "@/components/property/property-image";
import { Badge } from "@/components/ui/feedback";
import { formatStayDate } from "@/lib/dates";
import { pluralize } from "@/lib/utils";

/** Property + dates + party summary shared by reserve, checkout and booking pages. */
export function StaySummary({
  property,
  checkIn,
  checkOut,
  nights,
  adults,
  childCount,
  isDemo,
}: {
  property: { title: string; destination: { name: string } | null; locality: string | null; images: { url: string; alt: string }[] };
  checkIn: Date;
  checkOut: Date;
  nights: number;
  adults: number;
  childCount: number;
  isDemo: boolean;
}) {
  return (
    <div className="flex gap-4">
      <PropertyImage src={property.images[0]?.url ?? null} alt={property.images[0]?.alt ?? ""} sizes="7rem" className="aspect-square w-24 shrink-0 rounded-xl sm:w-28" />
      <div className="min-w-0">
        <p className="text-xs font-bold tracking-wider text-eucalypt-600 uppercase">{property.destination?.name ?? property.locality}</p>
        <p className="font-display text-lg leading-snug">{property.title}</p>
        <p className="mt-1 text-sm text-ink-soft">
          {formatStayDate(checkIn)} → {formatStayDate(checkOut)} · {pluralize(nights, "night")}
        </p>
        <p className="text-sm text-ink-soft">
          {pluralize(adults, "adult")}
          {childCount > 0 && `, ${pluralize(childCount, "child", "children")}`}
        </p>
        {isDemo && (
          <Badge tone="demo" className="mt-2">
            Demo listing
          </Badge>
        )}
      </div>
    </div>
  );
}
