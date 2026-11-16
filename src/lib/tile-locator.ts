/**
 * Which of our own map tiles a small round locator needs, and where to put them.
 *
 * Web Mercator, 256px tiles, the scheme `public/geo/earth/v2/{month}/{z}/{x}/{y}.webp`
 * is cut in. Given a point and a square window, it returns every tile that
 * window overlaps and each tile's offset inside it, so the point sits exactly
 * in the middle. Nothing is fetched from anywhere but our own origin, and
 * nothing here is a fact about the place: it is drawing geometry.
 *
 * Pure: no I/O, no clock.
 */

export const TILE_SIZE = 256;

/** The deepest zoom the shipped earth tiles go to. */
export const EARTH_MAX_ZOOM = 4;

export interface PlacedTile {
  readonly z: number;
  readonly x: number;
  readonly y: number;
  /** Where the tile's top-left corner sits inside the window, in px. */
  readonly left: number;
  readonly top: number;
}

/** A longitude and latitude as world pixels at a zoom. */
export function worldPixel(
  [longitude, latitude]: readonly [number, number],
  zoom: number,
): { x: number; y: number } {
  const scale = TILE_SIZE * 2 ** zoom;
  // Mercator is undefined at the poles; the tiles stop at about 85.0511°.
  const clamped = Math.max(-85.0511, Math.min(85.0511, latitude));
  const sin = Math.sin((clamped * Math.PI) / 180);

  return {
    x: ((longitude + 180) / 360) * scale,
    y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * scale,
  };
}

export function tilesForWindow(
  position: readonly [number, number],
  zoom: number,
  windowPx: number,
): PlacedTile[] {
  const count = 2 ** zoom;
  const centre = worldPixel(position, zoom);
  const originX = centre.x - windowPx / 2;
  const originY = centre.y - windowPx / 2;

  const tiles: PlacedTile[] = [];
  const firstX = Math.floor(originX / TILE_SIZE);
  const lastX = Math.floor((originX + windowPx - 1) / TILE_SIZE);
  const firstY = Math.max(0, Math.floor(originY / TILE_SIZE));
  const lastY = Math.min(count - 1, Math.floor((originY + windowPx - 1) / TILE_SIZE));

  for (let tx = firstX; tx <= lastX; tx += 1) {
    for (let ty = firstY; ty <= lastY; ty += 1) {
      tiles.push({
        z: zoom,
        // Wraps across the antimeridian; the y axis does not wrap.
        x: ((tx % count) + count) % count,
        y: ty,
        left: Math.round(tx * TILE_SIZE - originX),
        top: Math.round(ty * TILE_SIZE - originY),
      });
    }
  }

  return tiles;
}
