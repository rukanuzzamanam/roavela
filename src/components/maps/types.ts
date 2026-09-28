import type { ComponentType } from "react";

/**
 * Map-provider contract. Every map in the app renders through `<MapView>` with these props, so an
 * interactive provider (Mapbox GL, Google Maps) can be added without touching pages.
 *
 * All coordinates passed to a map are public data: property positions are pre-rounded by the
 * server (see services/drive-time.ts#approximateLocation). Maps must never receive exact addresses.
 */
export interface MapMarker {
  id: string;
  latitude: number;
  longitude: number;
  /** Short visible label, e.g. a price or place name. */
  label: string;
  /** Full description for screen readers. */
  ariaLabel: string;
  href?: string;
  kind: "stay" | "origin" | "attraction";
}

/** A deliberately fuzzy area (used instead of a pin for a property's location before booking). */
export interface MapArea {
  latitude: number;
  longitude: number;
  radiusMeters: number;
  label: string;
}

export interface MapViewProps {
  markers: MapMarker[];
  areas?: MapArea[];
  /** Draw dashed "road trip" lines from the origin marker to each stay. */
  connectOrigin?: boolean;
  ariaLabel: string;
  caption?: string;
  className?: string;
}

export type MapProviderId = "fallback" | "mapbox" | "google";

export interface MapProvider {
  id: MapProviderId;
  /** Whether the map supports pan/zoom. The fallback is a static schematic. */
  interactive: boolean;
  Map: ComponentType<MapViewProps>;
}
