import Link from "next/link";
import { formatDriveTime } from "@/lib/geo";
import { formatMoney } from "@/lib/money";
import type { PropertyCardData } from "@/types/marketplace";

/**
 * Map view.
 *
 * Map-provider abstraction point: when an interactive provider (Mapbox GL / Google Maps) is added,
 * render it here when its public token is configured. Until then this schematic map plots results
 * by coordinates (equirectangular projection) so the map view works with no API key. It shows
 * relative position only — no roads — and says so.
 */
export function ResultsMap({
  results,
  origin,
  query,
}: {
  results: PropertyCardData[];
  origin: { name: string; latitude: number; longitude: number } | null;
  query: string;
}) {
  const points = [...results.map((r) => ({ lat: r.latitude, lng: r.longitude })), ...(origin ? [{ lat: origin.latitude, lng: origin.longitude }] : [])];
  if (points.length === 0) return null;

  const pad = 0.12;
  const lats = points.map((p) => p.lat);
  const lngs = points.map((p) => p.lng);
  let [minLat, maxLat, minLng, maxLng] = [Math.min(...lats), Math.max(...lats), Math.min(...lngs), Math.max(...lngs)];
  const latSpan = Math.max(maxLat - minLat, 0.2);
  const lngSpan = Math.max(maxLng - minLng, 0.2);
  minLat -= latSpan * pad;
  maxLat += latSpan * pad;
  minLng -= lngSpan * pad;
  maxLng += lngSpan * pad;

  // Correct longitude scale for latitude so shapes aren't stretched.
  const midLat = ((minLat + maxLat) / 2) * (Math.PI / 180);
  const width = 1000;
  const height = Math.round((width * (maxLat - minLat)) / ((maxLng - minLng) * Math.cos(midLat)));
  const clampedHeight = Math.min(Math.max(height, 420), 1100);
  const x = (lng: number) => ((lng - minLng) / (maxLng - minLng)) * 100;
  const y = (lat: number) => ((maxLat - lat) / (maxLat - minLat)) * 100;

  return (
    <figure className="overflow-hidden rounded-[var(--radius-card)] border border-ink/10 bg-white shadow-card">
      <div
        className="relative w-full bg-[radial-gradient(circle_at_30%_20%,var(--color-eucalypt-50),transparent_60%),linear-gradient(135deg,var(--color-sand-100),var(--color-eucalypt-50))]"
        style={{ aspectRatio: `${width} / ${clampedHeight}` }}
      >
        {/* Subtle grid to read as a map surface */}
        <svg className="absolute inset-0 size-full text-eucalypt-200/60" aria-hidden>
          <defs>
            <pattern id="map-grid" width="48" height="48" patternUnits="userSpaceOnUse">
              <path d="M48 0H0V48" fill="none" stroke="currentColor" strokeWidth="1" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#map-grid)" />
          {origin &&
            results.map((r) => (
              <line
                key={r.id}
                x1={`${x(origin.longitude)}%`}
                y1={`${y(origin.latitude)}%`}
                x2={`${x(r.longitude)}%`}
                y2={`${y(r.latitude)}%`}
                stroke="var(--color-ochre-300)"
                strokeWidth="1.5"
                strokeDasharray="4 6"
                opacity="0.55"
              />
            ))}
        </svg>

        {origin && (
          <div
            className="absolute -translate-x-1/2 -translate-y-1/2"
            style={{ left: `${x(origin.longitude)}%`, top: `${y(origin.latitude)}%` }}
          >
            <span className="flex items-center gap-1.5 rounded-full bg-eucalypt-800 px-3 py-1.5 text-xs font-bold text-white shadow-float">
              <span className="size-2 rounded-full bg-ochre-300" aria-hidden />
              {origin.name}
            </span>
          </div>
        )}

        <ul aria-label="Stays on the map">
          {results.map((r) => (
            <li key={r.id} className="absolute -translate-x-1/2 -translate-y-full" style={{ left: `${x(r.longitude)}%`, top: `${y(r.latitude)}%` }}>
              <Link
                href={`/stays/${r.slug}${query ? `?${query}` : ""}`}
                className="block rounded-full border border-ink/10 bg-white px-2.5 py-1 text-xs font-bold whitespace-nowrap shadow-card transition hover:z-10 hover:scale-110 hover:bg-eucalypt-700 hover:text-white focus-visible:z-10"
                aria-label={`${r.title}, ${formatMoney(r.nightlyPriceCents, r.currency)} per night${r.drive ? `, about ${formatDriveTime(r.drive.durationMinutes)} drive` : ""}`}
              >
                {formatMoney(r.nightlyPriceCents, r.currency)}
              </Link>
            </li>
          ))}
        </ul>
      </div>
      <figcaption className="border-t border-ink/10 px-4 py-2.5 text-xs text-mist">
        Schematic view showing approximate relative positions, not roads. Exact addresses are shared after booking.
      </figcaption>
    </figure>
  );
}
