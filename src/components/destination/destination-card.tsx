import Link from "next/link";
import { PropertyImage } from "@/components/property/property-image";
import { Icon } from "@/components/ui/icons";
import { formatDriveTime } from "@/lib/geo";
import { pluralize } from "@/lib/utils";
import type { DestinationSummary } from "@/types/marketplace";

export function DestinationCard({ destination: d, originSlug }: { destination: DestinationSummary; originSlug: string }) {
  return (
    <Link
      href={`/search?from=${originSlug}&to=${d.slug}`}
      className="group relative block overflow-hidden rounded-[var(--radius-card)] shadow-card"
    >
      <PropertyImage
        src={d.heroImageUrl}
        alt=""
        sizes="(min-width: 1024px) 25vw, (min-width: 640px) 45vw, 80vw"
        className="aspect-[3/4] transition-transform duration-500 group-hover:scale-[1.03]"
      />
      <div className="absolute inset-0 bg-gradient-to-t from-ink/80 via-ink/10 to-transparent" aria-hidden />
      <div className="absolute inset-x-0 bottom-0 p-5 text-white">
        {d.drive && (
          <p className="mb-2 inline-flex items-center gap-1.5 rounded-full bg-white/15 px-2.5 py-1 text-xs font-semibold backdrop-blur">
            <Icon name="car" size={14} />
            {formatDriveTime(d.drive.durationMinutes)}
            <span className="sr-only"> approximate drive from {d.drive.originName}</span>
          </p>
        )}
        <h3 className="font-display text-2xl leading-tight">{d.name}</h3>
        {d.tagline && <p className="mt-1 line-clamp-2 text-sm text-white/85">{d.tagline}</p>}
        <p className="mt-2 text-sm font-semibold">{pluralize(d.stayCount, "stay")}</p>
      </div>
    </Link>
  );
}
