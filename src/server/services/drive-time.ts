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
 * Round coordinates for public display (~1 km at Australian latitudes). Exact coordinates are
 * never sent to the browser before booking — they may identify a host's home.
 */
export function approximateLocation({ latitude, longitude }: LatLng): LatLng {
  return { latitude: Math.round(latitude * 100) / 100, longitude: Math.round(longitude * 100) / 100 };
}
