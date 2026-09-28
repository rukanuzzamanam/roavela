import "server-only";
import type { TravelEstimateSource } from "@/generated/prisma/enums";
import { estimateDriveHeuristic, type DriveEstimateResult, type LatLng } from "@/lib/geo";

/**
 * Routing abstraction.
 *
 * Search never calls a routing API per request: it reads stored `DriveEstimate` rows (origin →
 * destination) and adds a short heuristic local leg per property (see services/drive-time.ts).
 * A `RoutingProvider` is what *produces* those stored estimates. To add Mapbox Directions or
 * Google Routes, implement this interface, register it in `getRoutingProvider()`, and write its
 * results with source = ROUTING_API — the UI then stops labelling those times as estimates.
 */
export interface RoutingProvider {
  readonly source: TravelEstimateSource;
  readonly name: string;
  /** True when results are approximations rather than routed road distances. */
  readonly isEstimate: boolean;
  getDrivingDistance(from: LatLng, to: LatLng): Promise<{ meters: number }>;
  getDrivingDuration(from: LatLng, to: LatLng): Promise<{ minutes: number }>;
  /** Distance and duration in one call (providers usually return both together). */
  estimateDrive(from: LatLng, to: LatLng): Promise<DriveEstimateResult>;
}

/** Straight-line distance × road factor. Needs no API key; always labelled approximate. */
export class HeuristicRoutingProvider implements RoutingProvider {
  readonly source = "HEURISTIC" as const;
  readonly name = "heuristic";
  readonly isEstimate = true;

  async estimateDrive(from: LatLng, to: LatLng) {
    return estimateDriveHeuristic(from, to);
  }
  async getDrivingDistance(from: LatLng, to: LatLng) {
    return { meters: estimateDriveHeuristic(from, to).distanceMeters };
  }
  async getDrivingDuration(from: LatLng, to: LatLng) {
    return { minutes: estimateDriveHeuristic(from, to).durationMinutes };
  }
}

export function getRoutingProvider(): RoutingProvider {
  // Only the heuristic provider exists today (ROUTING_PROVIDER="heuristic").
  return new HeuristicRoutingProvider();
}
