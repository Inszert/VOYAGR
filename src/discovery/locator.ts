/**
 * A locator map: where one place is, drawn from the product's own geography.
 *
 * Pure. It takes land polygons and named places already read from the
 * Natural Earth files in `public/geo` and returns SVG path data, label
 * positions and a scale bar - no I/O, no clock, nothing random. The page's
 * loader is what reads the files.
 *
 * **Regional, on purpose.** The geography is Natural Earth at 1:50m, which is
 * a few kilometres between vertices. That draws a coast, an island and the
 * places around them truthfully; it cannot draw a street, and zooming it in
 * until it pretended to would be inventing a map. So the frame is a region
 * about two hundred kilometres across, the marker is exact, and the distance
 * a provider stated to the centre is said in words beside it.
 *
 * The projection is equirectangular with the longitude scaled by the cosine
 * of the frame's latitude. Over a frame this size that is indistinguishable
 * from anything cleverer, and it keeps north up and distances honest enough
 * for a scale bar.
 */

export interface LngLat {
  readonly longitude: number;
  readonly latitude: number;
}

export interface LocatorPlace {
  readonly name: string;
  readonly kind: string;
  readonly position: readonly [number, number];
}

export interface LocatorInput {
  readonly centre: LngLat;
  /** Degrees of latitude from the centre to the top edge. */
  readonly halfSpanLatitude?: number;
  readonly width: number;
  readonly height: number;
  /** Outer rings of land polygons, as `[longitude, latitude]` pairs. */
  readonly land: readonly (readonly (readonly [number, number])[])[];
  readonly places: readonly LocatorPlace[];
}

export interface LocatorMap {
  readonly width: number;
  readonly height: number;
  /** One SVG path per land polygon that reaches into the frame. */
  readonly land: readonly string[];
  readonly places: readonly { readonly name: string; readonly x: number; readonly y: number }[];
  readonly marker: { readonly x: number; readonly y: number };
  readonly scale: { readonly kilometres: number; readonly pixels: number };
}

/** Kilometres in one degree of latitude. */
const KM_PER_DEGREE = 111.32;

/** Round figures for a scale bar. */
const SCALE_STEPS = [5, 10, 20, 25, 50, 100, 200, 250, 500] as const;

function round(value: number): number {
  return Math.round(value * 10) / 10;
}

export function buildLocator(input: LocatorInput): LocatorMap {
  const { centre, width, height } = input;
  const halfLat = input.halfSpanLatitude ?? 0.9;

  // Pixels per degree of latitude, and the longitude squeeze at this latitude.
  const k = height / 2 / halfLat;
  const squeeze = Math.cos((centre.latitude * Math.PI) / 180);
  const halfLon = width / 2 / (k * squeeze);

  const west = centre.longitude - halfLon;
  const east = centre.longitude + halfLon;
  const south = centre.latitude - halfLat;
  const north = centre.latitude + halfLat;

  const x = (longitude: number) => round((longitude - centre.longitude) * squeeze * k + width / 2);
  const y = (latitude: number) => round(height / 2 - (latitude - centre.latitude) * k);

  const land: string[] = [];

  for (const ring of input.land) {
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;

    for (const [longitude, latitude] of ring) {
      if (longitude < minX) minX = longitude;
      if (longitude > maxX) maxX = longitude;
      if (latitude < minY) minY = latitude;
      if (latitude > maxY) maxY = latitude;
    }

    // Polygons wholly outside the frame are skipped; the SVG clips the rest.
    if (maxX < west || minX > east || maxY < south || minY > north) continue;

    land.push(
      `${ring.map(([longitude, latitude], index) => `${index === 0 ? 'M' : 'L'}${x(longitude)} ${y(latitude)}`).join('')}Z`,
    );
  }

  const places = input.places
    .filter(({ position: [longitude, latitude] }) => {
      // Inset from the edges so a label is never cut in half.
      const margin = halfLat * 0.12;
      return (
        longitude > west + margin &&
        longitude < east - margin &&
        latitude > south + margin &&
        latitude < north - margin
      );
    })
    .map(({ name, position: [longitude, latitude] }) => ({
      name,
      x: x(longitude),
      y: y(latitude),
    }));

  // The largest round distance that fits in a quarter of the width.
  const kmPerPixel = KM_PER_DEGREE / k;
  const fits = SCALE_STEPS.filter((step) => step / kmPerPixel <= width / 4);
  const kilometres = fits[fits.length - 1] ?? SCALE_STEPS[0];

  return {
    width,
    height,
    land,
    places,
    marker: { x: x(centre.longitude), y: y(centre.latitude) },
    scale: { kilometres, pixels: round(kilometres / kmPerPixel) },
  };
}
