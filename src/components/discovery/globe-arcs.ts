import type { Map as MapLibreMap } from 'maplibre-gl';

/**
 * Flight arcs that leave the ground.
 *
 * A map style paints on the surface. Every layer in one - a line, a fill, a
 * symbol - is stuck to the sphere, which is why the routes drawn inside the
 * style read as lines ruled on a globe rather than as journeys over it. The
 * reference image's arcs bow above the limb and pass in front of the planet,
 * and that cannot be a style layer. So it is an SVG over the canvas, and this
 * module is the geometry behind it.
 *
 * **It originates nothing.** The coordinates come from `greatCirclePath` in
 * `src/discovery/geo.ts`, computed on the server, and are the same ones the
 * style draws on the ground. What happens here is projection: where MapLibre
 * puts each of those points on screen this frame, and how far off the surface
 * to lift it.
 *
 * The lift is one line of arithmetic and it is worth stating why it is
 * correct. Under any central projection of a sphere - orthographic or
 * perspective - a point raised straight up from the surface moves directly
 * away from the centre of the projected disc, and moves by the same fraction
 * it was raised by. A point in the middle of the disc is coming straight at
 * the viewer and does not move at all; a point at the limb moves outward past
 * the silhouette, which is exactly what an arc rising over the horizon does.
 * So the whole of it is: scale the screen vector from the disc's centre.
 */

/** Degrees to radians. */
const RADIANS = Math.PI / 180;

/**
 * The sphere's projected diameter in pixels, from the zoom.
 *
 * MapLibre draws the globe with the Mercator world's width as its
 * circumference: 512px at zoom zero, doubling per level. The diameter is
 * therefore that over pi - about 163px at zoom zero.
 *
 * **This is the sphere's size, not its silhouette's.** MapLibre's globe is a
 * perspective projection, so the camera sees rather less than a hemisphere
 * and the painted disc is meaningfully smaller than this - by about a sixth
 * at the zoom the front page opens at. It is the right number for choosing an
 * opening zoom, which is what it is used for, and the wrong one for anything
 * that has to line up with the edge of the planet on screen. Those use
 * `measureSilhouette` below.
 */
export function sphereDiameter(zoom: number): number {
  return (512 * 2 ** zoom) / Math.PI;
}

/**
 * A point a given angular distance away, due east.
 *
 * The standard destination-point formula at a bearing of 90 degrees, which is
 * well defined from anywhere including a pole. Only used to walk outwards from
 * the middle of the view looking for the limb.
 */
function eastOf(lng: number, lat: number, angle: number): [number, number] {
  const from = lat * RADIANS;
  const sinTo = Math.sin(from) * Math.cos(angle);
  const to = Math.asin(Math.min(1, Math.max(-1, sinTo)));

  const longitude =
    lng * RADIANS +
    Math.atan2(Math.sin(angle) * Math.cos(from), Math.cos(angle) - Math.sin(from) * sinTo);

  return [((longitude / RADIANS + 540) % 360) - 180, to / RADIANS];
}

/**
 * How wide the planet actually is on screen, measured rather than assumed.
 *
 * Walks outwards from the middle of the view and asks MapLibre where each
 * step lands; the furthest one it puts on screen is the silhouette. Twelve
 * projections, once per change of view, and it is correct at every zoom and
 * in either projection without a calibration constant anywhere.
 *
 * The alternative - `sphereDiameter(zoom)` - is the size of the sphere in the
 * projection's own units and is about a sixth larger than the disc the
 * perspective camera paints. Everything drawn around the limb was sized from
 * it, which put a dark ring of overlay on the page outside the planet.
 */
function measureSilhouette(
  map: MapLibreMap,
  centre: { x: number; y: number },
  lng: number,
  lat: number,
): number {
  let widest = 0;

  for (let step = 1; step <= 12; step += 1) {
    const angle = (step / 12) * (Math.PI / 2) * 0.995;
    const point = map.project(eastOf(lng, lat, angle));

    // A transform that is mid-change can answer with nothing. One missing
    // sample out of twelve is not worth a thrown frame.
    if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) continue;

    const distance = Math.hypot(point.x - centre.x, point.y - centre.y);
    if (distance > widest) widest = distance;
  }

  return widest * 2;
}

/**
 * How high an arc rises at its midpoint, as a fraction of the sphere's radius.
 *
 * **Scaled by how far the route actually goes.** A fixed lift gives a hop to
 * Split the same bulge as a flight to Bangkok, and at this size that reads as
 * a stubby purple hoop sitting on Europe rather than as a journey. The rise is
 * proportional to the great-circle angle, so a short route stays close to the
 * ground and only something crossing a hemisphere reaches the full height.
 */
const LIFT = 0.18;

/** The angular distance, in radians, at which a route earns the full lift. */
const LIFT_FULL = Math.PI / 2;

/**
 * Below this, the two ends are the same place as far as a drawn arc is
 * concerned: it would start and finish inside its own line width.
 */
const MINIMUM_SPAN = 1.5 * (Math.PI / 180);

/**
 * How close to the limb a sample may be drawn.
 *
 * MapLibre's globe is a perspective projection, so the visible cap is a
 * little smaller than a hemisphere and `project` stops being meaningful just
 * before the geometric horizon. Clipping slightly inside it keeps every
 * coordinate this module uses one MapLibre would vouch for; the lift then
 * carries the last sample outside the silhouette anyway, which is where the
 * arc is supposed to disappear.
 */
const COS_HORIZON = 0.06;

/** Above this zoom the sphere no longer fits any box, and the arcs retire. */
export const ARC_MAX_ZOOM = 3.4;

/** A route as the overlay needs it: one continuous run of positions. */
export interface ArcRun {
  /** `[longitude, latitude]`, from the server's great circle. */
  readonly points: readonly (readonly [number, number])[];
  /** Where along the whole route each point sits, 0 to 1. */
  readonly fractions: readonly number[];
  /** 0 is the best-ranked route. Thicker and brighter. */
  readonly rank: number;
  /** How high this route rises, as a fraction of the radius. */
  readonly lift: number;
  readonly selected: boolean;
  /** Stable across renders, so a pulse keeps its phase. */
  readonly key: string;
}

/** Loosely typed: this is the GeoJSON the server built, and only read here. */
interface RouteFeature {
  geometry?: { type?: string; coordinates?: unknown };
  properties?: { destination?: string; rank?: number; selected?: boolean };
}

/**
 * The routes, resampled for drawing.
 *
 * Two things happen. The antimeridian split the server made for the map style
 * becomes separate runs, because a run is a `<path>`; and the sixty-five
 * points of a great circle are thinned, because the bow is smooth and every
 * point kept is a matrix multiply per frame.
 */
export function toArcRuns(routes: unknown, maxPoints = 30): ArcRun[] {
  const features = (routes as { features?: readonly RouteFeature[] } | null)?.features ?? [];
  const runs: ArcRun[] = [];

  for (const feature of features) {
    const raw = feature.geometry?.coordinates;
    if (feature.geometry?.type !== 'MultiLineString' || !Array.isArray(raw)) continue;

    const segments = raw as (readonly [number, number])[][];
    const total = segments.reduce((count, segment) => count + segment.length, 0);
    if (total < 2) continue;

    const rank = Number(feature.properties?.rank ?? 9);
    const selected = feature.properties?.selected === true;
    const destination = String(feature.properties?.destination ?? runs.length);

    /*
     * How far the whole route goes, and therefore how high it rises.
     *
     * Measured end to end rather than per segment, so a route split at the
     * antimeridian is still one journey. A pair of endpoints closer together
     * than a line width is not drawn at all - an arc that starts and ends in
     * the same place is a purple full stop.
     */
    const first = segments[0]?.[0];
    const last = segments[segments.length - 1]?.slice(-1)[0];
    if (!first || !last) continue;

    const span = Math.acos(
      Math.max(
        -1,
        Math.min(
          1,
          Math.sin(first[1] * RADIANS) * Math.sin(last[1] * RADIANS) +
            Math.cos(first[1] * RADIANS) *
              Math.cos(last[1] * RADIANS) *
              Math.cos((last[0] - first[0]) * RADIANS),
        ),
      ),
    );

    if (span < MINIMUM_SPAN) continue;

    const lift = LIFT * Math.min(1, span / LIFT_FULL);

    let seen = 0;

    for (const [index, segment] of segments.entries()) {
      // Thin to roughly `maxPoints`, always keeping both ends so a route
      // still starts on its airport and finishes on its destination.
      const step = Math.max(1, Math.ceil(segment.length / maxPoints));
      const points: (readonly [number, number])[] = [];
      const fractions: number[] = [];

      for (let at = 0; at < segment.length; at += step) {
        points.push(segment[at]!);
        fractions.push((seen + at) / (total - 1));
      }

      if (points[points.length - 1] !== segment[segment.length - 1]) {
        points.push(segment[segment.length - 1]!);
        fractions.push((seen + segment.length - 1) / (total - 1));
      }

      seen += segment.length;

      if (points.length > 1) {
        runs.push({ points, fractions, rank, selected, lift, key: `${destination}-${index}` });
      }
    }
  }

  // Best first, so the strongest arc is painted last and sits on top.
  return runs.sort((a, b) => b.rank - a.rank);
}

/** Where the sphere is on screen this frame, and how much of it is one. */
export interface SphereFrame {
  /** The centre of the projected disc, in container pixels. */
  readonly x: number;
  readonly y: number;
  readonly diameter: number;
  /** The view's centre, which is also the direction the viewer is facing. */
  readonly lng: number;
  readonly lat: number;
  /** 1 while the planet reads as a ball, 0 once it does not. */
  readonly shown: number;
}

/**
 * Read the sphere off the map.
 *
 * `shown` is what everything drawn around the silhouette is faded by: the
 * atmosphere and the arcs are statements about a ball, and once somebody has
 * zoomed in far enough that the globe fills the frame - or switched to the
 * flat map - there is no ball on screen to make them about.
 */
export function readSphere(map: MapLibreMap, globe: boolean): SphereFrame {
  const centre = map.getCenter();
  const point = map.project(centre) ?? { x: 0, y: 0 };
  const zoom = map.getZoom();

  const fade = globe ? 1 - Math.max(0, Math.min(1, (zoom - (ARC_MAX_ZOOM - 0.9)) / 0.9)) : 0;

  return {
    x: point.x,
    y: point.y,
    diameter: globe ? measureSilhouette(map, point, centre.lng, centre.lat) : sphereDiameter(zoom),
    lng: centre.lng,
    lat: centre.lat,
    shown: fade,
  };
}

/**
 * The cosine of the angle between a position and the direction being faced.
 *
 * Positive is the near side of the planet, negative the far side. Cheaper and
 * steadier than a haversine here: it is wanted as a cosine, and taking an arc
 * cosine only to take its cosine again loses precision near the limb, which
 * is the one place this is read carefully.
 */
function facing(lng: number, lat: number, frame: SphereFrame): number {
  const a = lat * RADIANS;
  const b = frame.lat * RADIANS;

  return (
    Math.sin(a) * Math.sin(b) + Math.cos(a) * Math.cos(b) * Math.cos((lng - frame.lng) * RADIANS)
  );
}

/** A projected arc: its path, and the screen points behind it. */
export interface ProjectedArc {
  readonly key: string;
  readonly d: string;
  readonly rank: number;
  readonly selected: boolean;
  readonly points: readonly { readonly x: number; readonly y: number }[];
}

/**
 * One route, projected and lifted.
 *
 * Returns null when nothing of it is on the near side - a route to the other
 * hemisphere while the planet is turned away is not a faint line, it is
 * behind the world.
 */
export function projectArc(map: MapLibreMap, run: ArcRun, frame: SphereFrame): ProjectedArc | null {
  const radius = frame.diameter / 2;
  if (radius <= 0) return null;

  const parts: string[] = [];
  const points: { x: number; y: number }[] = [];
  let open = false;

  for (const [index, position] of run.points.entries()) {
    const [lng, lat] = position;

    if (facing(lng, lat, frame) < COS_HORIZON) {
      // Over the horizon. End the run rather than joining across the planet,
      // which would draw a chord through it.
      open = false;
      continue;
    }

    const ground = map.project([lng, lat]);
    if (!ground || !Number.isFinite(ground.x) || !Number.isFinite(ground.y)) continue;

    const scale = 1 + run.lift * Math.sin(Math.PI * (run.fractions[index] ?? 0));

    const x = frame.x + (ground.x - frame.x) * scale;
    const y = frame.y + (ground.y - frame.y) * scale;

    points.push({ x, y });
    parts.push(`${open ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`);
    open = true;
  }

  if (points.length < 2) return null;

  return { key: run.key, d: parts.join(' '), rank: run.rank, selected: run.selected, points };
}

/**
 * Where along an arc something travelling it would be.
 *
 * The pulse that walks each route. It reads the points already projected for
 * the path rather than projecting again, so the light is on the line it is
 * meant to be on even mid-gesture.
 */
export function pointAt(
  arc: ProjectedArc,
  fraction: number,
): { readonly x: number; readonly y: number } | null {
  const count = arc.points.length;
  if (count < 2) return null;

  const at = Math.max(0, Math.min(0.9999, fraction)) * (count - 1);
  const index = Math.floor(at);
  const from = arc.points[index];
  if (!from) return null;

  const to = arc.points[index + 1] ?? from;
  const t = at - index;

  return { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t };
}

/**
 * Where the sun is on the disc, as CSS percentages.
 *
 * The sheen on the ocean is a highlight, and a highlight in the wrong place
 * is worse than none: it would say the sun is somewhere the terminator drawn
 * underneath it disagrees with. Null when the sub-solar point is on the far
 * side, so the sheen fades out rather than sliding to an edge.
 */
export function sunOnSphere(
  map: MapLibreMap,
  sun: { readonly longitude: number; readonly latitude: number },
  frame: SphereFrame,
): { readonly x: number; readonly y: number } | null {
  if (facing(sun.longitude, sun.latitude, frame) < 0.05) return null;

  const radius = frame.diameter / 2;
  if (radius <= 0) return null;

  const point = map.project([sun.longitude, sun.latitude]);
  if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return null;

  return {
    x: 50 + ((point.x - frame.x) / radius) * 50,
    y: 50 + ((point.y - frame.y) / radius) * 50,
  };
}
