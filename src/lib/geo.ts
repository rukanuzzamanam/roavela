export interface LatLng {
  latitude: number;
  longitude: number;
}

export interface DriveEstimateResult {
  durationMinutes: number;
  distanceMeters: number;
}

const EARTH_RADIUS_M = 6_371_000;

export function haversineMeters(a: LatLng, b: LatLng): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLng = toRad(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

export interface HeuristicOptions {
  /** Road distance ÷ straight-line distance. ~1.3–1.4 is typical for regional Australia. */
  roadFactor?: number;
  /** Average driving speed including urban sections. */
  averageKmh?: number;
}

/**
 * Rough drive estimate from straight-line distance. Used only when no stored or routed estimate exists.
 * Results must always be presented as approximate.
 */
export function estimateDriveHeuristic(from: LatLng, to: LatLng, opts: HeuristicOptions = {}): DriveEstimateResult {
  const { roadFactor = 1.35, averageKmh = 70 } = opts;
  const distanceMeters = Math.round(haversineMeters(from, to) * roadFactor);
  const durationMinutes = Math.round((distanceMeters / 1000 / averageKmh) * 60);
  return { distanceMeters, durationMinutes };
}

/**
 * Drive time to a specific property: the origin→destination estimate plus a local leg from the
 * destination's centre to the property (slower local roads).
 */
export function estimatePropertyDrive(
  regionEstimate: DriveEstimateResult,
  destinationCentre: LatLng,
  property: LatLng,
): DriveEstimateResult {
  const local = estimateDriveHeuristic(destinationCentre, property, { roadFactor: 1.4, averageKmh: 50 });
  return {
    durationMinutes: regionEstimate.durationMinutes + local.durationMinutes,
    distanceMeters: regionEstimate.distanceMeters + local.distanceMeters,
  };
}

export function formatDriveTime(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  const hours = Math.floor(m / 60);
  const rest = m % 60;
  if (hours === 0) return `${rest}m`;
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}

export function formatDistance(meters: number): string {
  return `${Math.round(meters / 1000)} km`;
}
