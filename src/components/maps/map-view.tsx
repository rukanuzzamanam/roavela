import { resolveMapProvider } from "./provider";
import type { MapViewProps } from "./types";

/** The single entry point for rendering a map. Pages never import a provider directly. */
export function MapView(props: MapViewProps) {
  const { Map } = resolveMapProvider();
  return <Map {...props} />;
}
