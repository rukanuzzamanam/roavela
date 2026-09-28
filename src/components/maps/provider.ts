import "server-only";
import { FallbackMap } from "./fallback-map";
import type { MapProvider, MapProviderId } from "./types";

/**
 * Map-provider registry.
 *
 * Only the fallback is implemented today. Adding Mapbox or Google means:
 *   1. implement a client component satisfying `MapViewProps` (loading the provider SDK lazily),
 *   2. register it below,
 *   3. set MAP_PROVIDER and the provider's public browser key in the environment.
 * If a provider is selected but its key is missing — or it isn't implemented yet — the fallback is
 * used, so development and builds never depend on a paid service.
 */
const IMPLEMENTED: Partial<Record<MapProviderId, MapProvider>> = {
  fallback: { id: "fallback", interactive: false, Map: FallbackMap },
};

const KEY_FOR: Record<Exclude<MapProviderId, "fallback">, string> = {
  mapbox: "NEXT_PUBLIC_MAPBOX_TOKEN",
  google: "NEXT_PUBLIC_GOOGLE_MAPS_API_KEY",
};

let warned = false;

export function resolveMapProvider(): MapProvider {
  const fallback = IMPLEMENTED.fallback!;
  const requested = (process.env.MAP_PROVIDER ?? "fallback") as MapProviderId;
  if (requested === "fallback" || !(requested in KEY_FOR)) return fallback;

  const hasKey = Boolean(process.env[KEY_FOR[requested as keyof typeof KEY_FOR]]);
  const provider = IMPLEMENTED[requested];
  if (provider && hasKey) return provider;

  if (!warned) {
    warned = true;
    console.warn(
      `[maps] MAP_PROVIDER="${requested}" ${provider ? "has no API key" : "is not implemented yet"}; using the fallback map.`,
    );
  }
  return fallback;
}
