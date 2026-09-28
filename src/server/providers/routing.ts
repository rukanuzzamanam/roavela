import "server-only";
import type { TravelEstimateSource } from "@/generated/prisma/enums";
import { estimateDriveHeuristic, type DriveEstimateResult, type LatLng } from "@/lib/geo";

/**
 * Routing abstraction. Stored `DriveEstimate` rows are the primary source for search; a provider
 * is used to (re)compute them. A real routing API (Mapbox Directions, Google Routes) can be added
 * by implementing `RoutingProvider` and writing results with source = ROUTING_API.
 */
export interface RoutingProvider {
  readonly source: TravelEstimateSource;
  readonly name: string;
  estimateDrive(from: LatLng, to: LatLng): Promise<DriveEstimateResult>;
}

export class HeuristicRoutingProvider implements RoutingProvider {
  readonly source = "HEURISTIC" as const;
  readonly name = "heuristic";
  async estimateDrive(from: LatLng, to: LatLng) {
    return estimateDriveHeuristic(from, to);
  }
}

export function getRoutingProvider(): RoutingProvider {
  // Only the heuristic provider exists today; see ROUTING_PROVIDER in .env.example.
  return new HeuristicRoutingProvider();
}
