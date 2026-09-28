import Link from "next/link";
import { MapView } from "@/components/maps/map-view";
import { Icon } from "@/components/ui/icons";
import { formatDistance, formatDriveTime } from "@/lib/geo";
import type { ExperienceCategory } from "@/generated/prisma/enums";
import type { DriveInfo } from "@/types/marketplace";

const CATEGORY_LABEL: Record<ExperienceCategory, string> = {
  WINE_TOUR: "Wine",
  RESTAURANT: "Food",
  HIKING: "Walk",
  KAYAKING: "Paddling",
  WHALE_WATCHING: "Wildlife",
  FAMILY_ATTRACTION: "Family",
  ADVENTURE: "Adventure",
  LOOKOUT: "Lookout",
  OTHER: "Attraction",
};

interface Nearby {
  id: string;
  title: string;
  category: ExperienceCategory;
  summary: string;
  latitude: number | null;
  longitude: number | null;
  distanceKm: number | null;
}

/**
 * Location for guests before booking: an approximate area (never the address or an exact pin),
 * the estimated drive, and nearby public attractions.
 */
export function LocationSection({
  title,
  locality,
  adminArea,
  area,
  radiusMeters,
  drive,
  destination,
  nearby,
}: {
  title: string;
  locality: string;
  adminArea: string | null;
  area: { latitude: number; longitude: number };
  radiusMeters: number;
  drive: DriveInfo | null;
  destination: { name: string; slug: string; isPublished: boolean };
  nearby: Nearby[];
}) {
  const mappable = nearby.filter((n): n is Nearby & { latitude: number; longitude: number } => n.latitude !== null && n.longitude !== null);
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-x-6 gap-y-2 text-ink-soft">
        <p className="flex items-center gap-2">
          <Icon name="pin" size={18} className="text-eucalypt-600" />
          {locality}
          {adminArea ? `, ${adminArea}` : ""} ·{" "}
          {destination.isPublished ? (
            <Link href={`/destinations/${destination.slug}`} className="font-semibold text-eucalypt-700 underline-offset-4 hover:underline">
              {destination.name}
            </Link>
          ) : (
            destination.name
          )}
        </p>
        {drive && (
          <p className="flex items-center gap-2">
            <Icon name="car" size={18} className="text-eucalypt-600" />
            About {formatDriveTime(drive.durationMinutes)} ({formatDistance(drive.distanceMeters)}) from {drive.originName}
            {drive.approximate && <span className="text-mist">— estimated</span>}
          </p>
        )}
      </div>

      <MapView
        ariaLabel={`Approximate area of ${title} and nearby attractions`}
        caption="The shaded circle shows the general area only. The exact address is shared after booking. Schematic view — not a road map."
        areas={[{ ...area, radiusMeters, label: `Approximate area of ${title}` }]}
        markers={mappable.map((n) => ({
          id: n.id,
          kind: "attraction" as const,
          latitude: n.latitude,
          longitude: n.longitude,
          label: n.title.length > 22 ? `${n.title.slice(0, 20)}…` : n.title,
          ariaLabel: `${n.title}${n.distanceKm ? `, about ${n.distanceKm} km away` : ""}`,
        }))}
      />

      {nearby.length > 0 && (
        <section aria-labelledby="nearby">
          <h3 id="nearby" className="mb-3 font-sans text-lg font-bold">
            Nearby attractions
          </h3>
          <ul className="grid gap-3 sm:grid-cols-2">
            {nearby.map((n) => (
              <li key={n.id} className="rounded-2xl border border-ink/10 bg-white p-4">
                <p className="text-xs font-bold tracking-wider text-ochre-600 uppercase">{CATEGORY_LABEL[n.category]}</p>
                <p className="font-semibold">{n.title}</p>
                <p className="mt-1 text-sm text-ink-soft">{n.summary}</p>
                {n.distanceKm !== null && <p className="mt-2 text-xs text-mist">About {n.distanceKm} km away (straight line)</p>}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
