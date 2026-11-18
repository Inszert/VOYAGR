import type { StyleSpecification } from 'maplibre-gl';

/**
 * The street map's base, shared by every map that draws one (the destination
 * "What to see" map and the stays map): OpenStreetMap's raster tiles, the one
 * third-party host these pages talk to for a map. `src/consent/csp.ts` names it
 * in `img-src` and `connect-src`. The credit line is part of the licence and is
 * always on screen.
 */
export const OSM_TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';

/** A style with the OpenStreetMap raster base and nothing else; callers may add sources and layers. */
export function osmStyle(
  extra: { sources?: StyleSpecification['sources']; layers?: StyleSpecification['layers'] } = {},
): StyleSpecification {
  return {
    version: 8,
    projection: { type: 'mercator' },
    sources: {
      osm: { type: 'raster', tiles: [OSM_TILE_URL], tileSize: 256, maxzoom: 19 },
      ...extra.sources,
    },
    layers: [{ id: 'osm', type: 'raster', source: 'osm' }, ...(extra.layers ?? [])],
  };
}

/** The licence's credit line, ours rather than the control's. Place inside a `relative` box. */
export function OsmCredit() {
  return (
    <p
      data-osm-credit=""
      className="absolute right-0 bottom-0 z-10 rounded-tl-lg rounded-br-[14px] bg-black/75 px-2 py-0.5 text-[11px] text-white"
    >
      <a
        href="https://www.openstreetmap.org/copyright"
        target="_blank"
        rel="noopener noreferrer"
        className="underline underline-offset-2"
      >
        © OpenStreetMap contributors
      </a>
    </p>
  );
}
