import Link from "next/link";
import { cn } from "@/lib/utils";
import type { MapViewProps } from "./types";

const KM_PER_DEG_LAT = 111;

/**
 * Development / fallback map: a static, dependency-free schematic that plots markers by
 * coordinates (equirectangular projection, longitude corrected for latitude). It needs no API key
 * and ships no client JavaScript. It shows relative position only — no roads, no basemap — and
 * says so in its caption, so it never implies geographic precision it doesn't have.
 */
export function FallbackMap({ markers, areas = [], connectOrigin = false, ariaLabel, caption, className }: MapViewProps) {
  const points = [
    ...markers.map((m) => ({ lat: m.latitude, lng: m.longitude })),
    ...areas.flatMap((a) => {
      const dLat = a.radiusMeters / 1000 / KM_PER_DEG_LAT;
      const dLng = dLat / Math.cos((a.latitude * Math.PI) / 180);
      return [
        { lat: a.latitude - dLat, lng: a.longitude - dLng },
        { lat: a.latitude + dLat, lng: a.longitude + dLng },
      ];
    }),
  ];
  if (points.length === 0) return null;

  const pad = 0.15;
  const lats = points.map((p) => p.lat);
  const lngs = points.map((p) => p.lng);
  let [minLat, maxLat, minLng, maxLng] = [Math.min(...lats), Math.max(...lats), Math.min(...lngs), Math.max(...lngs)];
  const latSpan = Math.max(maxLat - minLat, 0.05);
  const lngSpan = Math.max(maxLng - minLng, 0.05);
  const midLat = ((minLat + maxLat) / 2) * (Math.PI / 180);
  // Square-up the viewport so shapes aren't stretched.
  const widthKm = lngSpan * KM_PER_DEG_LAT * Math.cos(midLat);
  const heightKm = latSpan * KM_PER_DEG_LAT;
  const aspect = Math.min(Math.max(widthKm / heightKm, 0.9), 2.2);
  minLat -= latSpan * pad;
  maxLat += latSpan * pad;
  minLng -= lngSpan * pad;
  maxLng += lngSpan * pad;

  const x = (lng: number) => ((lng - minLng) / (maxLng - minLng)) * 100;
  const y = (lat: number) => ((maxLat - lat) / (maxLat - minLat)) * 100;
  const origin = markers.find((m) => m.kind === "origin");
  const stays = markers.filter((m) => m.kind === "stay");

  return (
    <figure className={cn("overflow-hidden rounded-[var(--radius-card)] border border-ink/10 bg-white shadow-card", className)}>
      <div
        role="group"
        aria-label={ariaLabel}
        className="relative w-full bg-[radial-gradient(circle_at_30%_20%,var(--color-eucalypt-50),transparent_60%),linear-gradient(135deg,var(--color-sand-100),var(--color-eucalypt-50))]"
        style={{ aspectRatio: `${aspect} / 1` }}
      >
        <svg className="absolute inset-0 size-full text-eucalypt-200/60" aria-hidden>
          <defs>
            <pattern id="map-grid" width="48" height="48" patternUnits="userSpaceOnUse">
              <path d="M48 0H0V48" fill="none" stroke="currentColor" strokeWidth="1" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#map-grid)" />
          {connectOrigin &&
            origin &&
            stays.map((m) => (
              <line
                key={m.id}
                x1={`${x(origin.longitude)}%`}
                y1={`${y(origin.latitude)}%`}
                x2={`${x(m.longitude)}%`}
                y2={`${y(m.latitude)}%`}
                stroke="var(--color-ochre-300)"
                strokeWidth="1.5"
                strokeDasharray="4 6"
                opacity="0.55"
              />
            ))}
        </svg>

        {areas.map((a) => {
          const radiusPctY = ((a.radiusMeters / 1000 / KM_PER_DEG_LAT) / (maxLat - minLat)) * 100;
          return (
            <div
              key={`${a.latitude},${a.longitude}`}
              aria-hidden
              className="absolute -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-eucalypt-500/60 bg-eucalypt-400/20"
              style={{ left: `${x(a.longitude)}%`, top: `${y(a.latitude)}%`, height: `${radiusPctY * 2}%`, aspectRatio: "1 / 1" }}
            />
          );
        })}

        <ul className="contents">
          {markers.map((m) => {
            const content =
              m.kind === "origin" ? (
                <span className="flex items-center gap-1.5 rounded-full bg-eucalypt-800 px-3 py-1.5 text-xs font-bold text-white shadow-float">
                  <span className="size-2 rounded-full bg-ochre-300" aria-hidden />
                  {m.label}
                </span>
              ) : m.kind === "attraction" ? (
                <span className="flex items-center gap-1 rounded-full border border-ochre-300 bg-ochre-50 px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap text-ochre-700 shadow-card">
                  {m.label}
                </span>
              ) : (
                <span className="block rounded-full border border-ink/10 bg-white px-2.5 py-1 text-xs font-bold whitespace-nowrap shadow-card transition group-hover:scale-110 group-hover:bg-eucalypt-700 group-hover:text-white group-focus-visible:bg-eucalypt-700 group-focus-visible:text-white">
                  {m.label}
                </span>
              );
            return (
              <li
                key={m.id}
                className={cn("absolute -translate-x-1/2", m.kind === "origin" ? "-translate-y-1/2" : "-translate-y-full", "hover:z-10 focus-within:z-10")}
                style={{ left: `${x(m.longitude)}%`, top: `${y(m.latitude)}%` }}
              >
                {m.href ? (
                  <Link href={m.href} aria-label={m.ariaLabel} className="group block rounded-full">
                    {content}
                  </Link>
                ) : (
                  <span role="img" aria-label={m.ariaLabel}>
                    {content}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      </div>
      <figcaption className="border-t border-ink/10 px-4 py-2.5 text-xs text-mist">
        {caption ?? "Schematic view of approximate relative positions — not a road map."}
      </figcaption>
    </figure>
  );
}
