import type { TravelEstimateSource } from "@/generated/prisma/enums";
import { estimateDriveHeuristic, estimatePropertyDrive, type LatLng } from "@/lib/geo";
import type { DriveInfo } from "@/types/marketplace";

/**
 * Drive time from an origin to a specific property, used by search results and property pages.
 *
 * - With a stored origin → destination estimate: that estimate plus a heuristic local leg from the
 *   destination centre to the property.
 * - Without one: a straight-line heuristic from the origin.
 *
 * The result is flagged `approximate` unless it comes entirely from a routing API — and the local
 * leg is always heuristic, so today every property-level time is approximate.
 */
export function resolvePropertyDrive(
  origin: { name: string } & LatLng,
  regional: { durationMinutes: number; distanceMeters: number; source?: TravelEstimateSource } | undefined,
  destinationCentre: LatLng,
  property: LatLng,
): DriveInfo {
  const estimate = regional
    ? estimatePropertyDrive(regional, destinationCentre, property)
    : estimateDriveHeuristic(origin, property);
  return { originName: origin.name, ...estimate, approximate: true };
}

/**
 * Where a property is, for drive-time and map purposes: its own coordinates when the host provided
 * them (precise), otherwise its destination's centre (approximate). Never invents a position.
 */
export function locateProperty(
  property: { latitude: number | null; longitude: number | null },
  destination: LatLng | null,
): { point: LatLng; precise: boolean } | null {
  if (property.latitude !== null && property.longitude !== null) {
    return { point: { latitude: property.latitude, longitude: property.longitude }, precise: true };
  }
  return destination ? { point: { latitude: destination.latitude, longitude: destination.longitude }, precise: false } : null;
}

/**
 * Round coordinates for public display (~1 km at Australian latitudes). Exact coordinates are
 * never sent to the browser before booking — they may identify a host's home.
 */
export function approximateLocation({ latitude, longitude }: LatLng): LatLng {
  return { latitude: Math.round(latitude * 100) / 100, longitude: Math.round(longitude * 100) / 100 };
}
