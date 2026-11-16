/**
 * Which places the globe names, chosen from the view.
 *
 * The globe used to pick five priced pins once and leave every other place as
 * a dim dot, so turning the planet showed the same five names drifting off the
 * edge and nothing coming round to replace them. This is the replacement: on
 * every camera move the labelled set is chosen again from what is facing the
 * camera - priced pins first, by rank, then the largest unpriced cities as
 * names - and the number of labels grows as somebody zooms in.
 *
 * Three rules keep it from flickering:
 *
 *  - **Hysteresis at the limb.** A place has to be well onto the visible face
 *    to gain a label ({@link LIMB_ENTER_COSINE}) and keeps it until it is
 *    within 12 degrees of the limb ({@link LIMB_EXIT_COSINE}). Turning the
 *    globe by a degree never swaps a name.
 *  - **Incumbents first.** Within each class, a label already on screen is
 *    placed before a newcomer, so a newcomer can only take its place when it
 *    leaves - by the limb, by the budget shrinking, or by colliding with
 *    something that ranks above it.
 *  - **Priced pins outrank names, always.** A price is an answer; a name is
 *    an invitation to ask. A name never holds a price off the globe.
 *
 * Pure: screen positions come from a projection function and every rectangle
 * from sizes measured once, so a pass reads no layout. The caller runs one per
 * camera move and applies the answer as classes on elements MapLibre already
 * positions by transform.
 */

/**
 * The catalogue of nameable places, built by `scripts/build-geo.mjs
 * --only=label-places`. Versioned like every `/geo/` file: never rewritten.
 */
export const LABEL_PLACES_URL = '/geo/label-places.v1.json';

/** A label sits beside its dot; this is where the dot is relative to the label's edge. */
export const DOT_INSET = 5;

/** Within 12 degrees of the limb a label is gone: sin(12 degrees). */
export const LIMB_EXIT_COSINE = Math.sin((12 * Math.PI) / 180);

/** A new label needs its place about 20 degrees onto the face first. */
export const LIMB_ENTER_COSINE = Math.sin((20 * Math.PI) / 180);

/** How far in, above the resting zoom, the second tier of places appears. */
export const TIER_TWO_ZOOM = 1.2;

export interface Rect {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

export interface LabelCandidate {
  readonly id: string;
  readonly lng: number;
  readonly lat: number;
  /** A priced pin rather than a name. */
  readonly priced: boolean;
  /** Lower comes first: a pin's rank, or a city's negated population. */
  readonly order: number;
  readonly width: number;
  readonly height: number;
}

export interface PlacedLabel {
  readonly x: number;
  readonly y: number;
  /** The words read leftwards from the dot. */
  readonly left: boolean;
}

export interface ChooseLabelsInput {
  readonly candidates: readonly LabelCandidate[];
  /** Container pixels, or null when the point is not on screen. */
  readonly project: (candidate: LabelCandidate) => { x: number; y: number } | null;
  /** How squarely the place faces the camera: 1 in the middle, 0 at the limb. */
  readonly cosine: (candidate: LabelCandidate) => number;
  readonly previous: ReadonlySet<string>;
  /** How many labels in all. */
  readonly budget: number;
  /** Priced pins are limited by collisions only, and names fill what is left of the budget. */
  readonly pricedUnlimited?: boolean;
  /** Where a label may sit, in container pixels. */
  readonly region: Rect;
  /** Panels and controls over the globe, in container pixels. */
  readonly obstacles: readonly Rect[];
  /** Prefer reading leftwards (for instance, away from the home airport's arc). */
  readonly preferLeft?: (candidate: LabelCandidate, x: number) => boolean;
  /** Clear space between two labels. */
  readonly gap?: number;
}

/**
 * The label budget for how far in the camera is.
 *
 * Roughly five at rest, twelve one step in and twenty-four two steps in (the
 * zoom buttons move 0.8 at a time), and fewer on a phone, where a label is a
 * larger share of the screen.
 */
export function labelBudget(zoomAboveRest: number, phone: boolean): number {
  if (zoomAboveRest < 0.4) return phone ? 3 : 5;
  if (zoomAboveRest < TIER_TWO_ZOOM) return phone ? 7 : 12;
  return phone ? 12 : 24;
}

/** The rectangle a label occupies with its dot at (x, y). */
export function labelRect(
  x: number,
  y: number,
  width: number,
  height: number,
  left: boolean,
): Rect {
  const start = left ? x + DOT_INSET - width : x - DOT_INSET;
  return { left: start, right: start + width, top: y - height / 2, bottom: y + height / 2 };
}

function inside(inner: Rect, outer: Rect): boolean {
  return (
    inner.left >= outer.left &&
    inner.right <= outer.right &&
    inner.top >= outer.top &&
    inner.bottom <= outer.bottom
  );
}

function overlaps(a: Rect, b: Rect, gap: number): boolean {
  return (
    a.left < b.right + gap &&
    a.right > b.left - gap &&
    a.top < b.bottom + gap &&
    a.bottom > b.top - gap
  );
}

/** The order labels are considered in: class, then incumbency, then rank. */
export function labelPriority(
  candidates: readonly LabelCandidate[],
  previous: ReadonlySet<string>,
): LabelCandidate[] {
  const klass = (candidate: LabelCandidate) =>
    (candidate.priced ? 0 : 2) + (previous.has(candidate.id) ? 0 : 1);

  return [...candidates].sort(
    (a, b) => klass(a) - klass(b) || a.order - b.order || a.id.localeCompare(b.id),
  );
}

export function chooseLabels(input: ChooseLabelsInput): Map<string, PlacedLabel> {
  const gap = input.gap ?? 4;
  const placed: Rect[] = [...input.obstacles];
  const shown = new Map<string, PlacedLabel>();
  let count = 0;

  for (const candidate of labelPriority(input.candidates, input.previous)) {
    const counts = !(candidate.priced && input.pricedUnlimited);
    // Spent: nothing else that counts can be placed, but an unlimited pin still can.
    if (counts && count >= input.budget) continue;

    const threshold = input.previous.has(candidate.id) ? LIMB_EXIT_COSINE : LIMB_ENTER_COSINE;
    if (input.cosine(candidate) < threshold) continue;

    const at = input.project(candidate);
    if (!at) continue;

    // Reads rightwards unless asked otherwise or it would run out of the region.
    const wantsLeft = input.preferLeft?.(candidate, at.x) ?? false;
    const right = labelRect(at.x, at.y, candidate.width, candidate.height, false);
    const leftward = labelRect(at.x, at.y, candidate.width, candidate.height, true);
    const order = wantsLeft ? [leftward, right] : [right, leftward];
    const fits = order.find((rect) => inside(rect, input.region));
    if (!fits) continue;

    if (placed.some((other) => overlaps(fits, other, gap))) continue;

    placed.push(fits);
    shown.set(candidate.id, { x: at.x, y: at.y, left: fits === leftward });
    if (counts) count += 1;
  }

  return shown;
}

/** A row of `public/geo/label-places.v*.json`. */
export type LabelPlaceRow = readonly [
  code: string,
  city: string,
  country: string | null,
  lon: number,
  lat: number,
  population: number,
  tier: number,
];

export interface LabelPlace {
  readonly code: string;
  readonly city: string;
  readonly country: string | null;
  readonly lng: number;
  readonly lat: number;
  readonly population: number;
  readonly tier: 1 | 2;
}

/** The catalogue file, checked: a row that is not the stated shape is dropped. */
export function parseLabelPlaces(value: unknown): LabelPlace[] {
  const rows = (value as { rows?: unknown } | null)?.rows;
  if (!Array.isArray(rows)) return [];

  const places: LabelPlace[] = [];
  for (const row of rows) {
    if (!Array.isArray(row) || row.length < 7) continue;
    const [code, city, country, lng, lat, population, tier] = row as unknown[];
    if (typeof code !== 'string' || !/^[A-Z]{3}$/.test(code)) continue;
    if (typeof city !== 'string' || city.length === 0) continue;
    if (country !== null && typeof country !== 'string') continue;
    if (typeof lng !== 'number' || typeof lat !== 'number') continue;
    if (Math.abs(lng) > 180 || Math.abs(lat) > 90) continue;
    if (typeof population !== 'number' || (tier !== 1 && tier !== 2)) continue;

    places.push({ code, city, country, lng, lat, population, tier });
  }

  return places;
}

/** What a name label says to somebody who cannot see it. */
export function placeLinkLabel(place: Pick<LabelPlace, 'city' | 'country'>): string {
  return `See prices for ${place.country ? `${place.city}, ${place.country}` : place.city}`;
}
