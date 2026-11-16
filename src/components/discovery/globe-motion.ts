/**
 * The globe's motion, as numbers.
 *
 * Everything the stage does over time - the camera's flight, the idle turn,
 * the arcs drawing and the light that travels them - is decided here as a pure
 * function of time, so the values in `docs/design-direction.md` (sections 3 and
 * 5) live in one place and a test can hold them. `globe-stage.tsx` only reads
 * the clock and applies the answers.
 *
 * Nothing in this file touches a price, a route or a position. It is timing.
 */

/** A CSS-style cubic bezier as a function of progress, for MapLibre's `easing`. */
export function cubicBezier(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): (progress: number) => number {
  const sample = (t: number, a: number, b: number) =>
    3 * (1 - t) ** 2 * t * a + 3 * (1 - t) * t ** 2 * b + t ** 3;
  const slope = (t: number, a: number, b: number) =>
    3 * (1 - t) ** 2 * a + 6 * (1 - t) * t * (b - a) + 3 * t ** 2 * (1 - b);

  return (progress) => {
    if (progress <= 0) return 0;
    if (progress >= 1) return 1;

    // Newton's method for the t whose x is `progress`, then bisection if it stalls.
    let t = progress;
    for (let step = 0; step < 6; step += 1) {
      const error = sample(t, x1, x2) - progress;
      if (Math.abs(error) < 1e-5) return sample(t, y1, y2);
      const gradient = slope(t, x1, x2);
      if (Math.abs(gradient) < 1e-6) break;
      t -= error / gradient;
    }

    let low = 0;
    let high = 1;
    t = progress;
    for (let step = 0; step < 24; step += 1) {
      const x = sample(t, x1, x2);
      if (Math.abs(x - progress) < 1e-5) break;
      if (x < progress) low = t;
      else high = t;
      t = (low + high) / 2;
    }

    return sample(t, y1, y2);
  };
}

/** `--ease-out-quart` and `--ease-out-expo`, as the same curves in script. */
export const EASE_OUT_QUART = cubicBezier(0.25, 1, 0.5, 1);
export const EASE_OUT_EXPO = cubicBezier(0.16, 1, 0.3, 1);

/** The CSS spelling of the quart curve, for the Web Animations API. */
export const EASE_OUT_QUART_CSS = 'cubic-bezier(0.25, 1, 0.5, 1)';

/** Flying to a destination, and back. */
export const FLY_MS = 1400;
export const RETURN_MS = 900;
/** Zoom added on top of the resting view when a destination is selected. */
export const FLY_ZOOM = 0.35;
/** Camera tilt while a destination is selected, in degrees. */
export const FLY_PITCH = 18;

/** One full turn in 240 seconds. */
export const SPIN_DEGREES_PER_SECOND = 360 / 240;
/** Quiet time after the last interaction before the turn resumes. */
export const SPIN_RESUME_DELAY_MS = 3000;
/** How long the turn takes to get back up to speed. */
export const SPIN_RAMP_MS = 1200;

/**
 * How fast the globe should be turning, as a fraction of full speed.
 *
 * `quietMs` is how long it has been since anything interrupted it. Zero until
 * the resume delay has passed, then a smooth ramp rather than a lurch.
 */
export function spinFactor(quietMs: number): number {
  if (quietMs <= SPIN_RESUME_DELAY_MS) return 0;

  const ramp = Math.min(1, (quietMs - SPIN_RESUME_DELAY_MS) / SPIN_RAMP_MS);
  return EASE_OUT_QUART(ramp);
}

/** Arcs: how long one takes to draw, how often its light travels, and the stagger. */
export const ARC_DRAW_MS = 900;
export const ARC_LIGHT_PERIOD_MS = 4000;
export const ARC_STAGGER_MS = 600;
export const MAX_ARCS = 6;

/**
 * Where an arc's travelling light is, 0 to 1, or null while it is waiting.
 *
 * `sinceDrawn` is the time since the arc finished drawing. Each route's light
 * starts `ARC_STAGGER_MS` after the one before it, so six of them do not leave
 * in step, and then goes once round every `ARC_LIGHT_PERIOD_MS` at constant
 * speed.
 */
export function arcLightFraction(sinceDrawnMs: number, index: number): number | null {
  const elapsed = sinceDrawnMs - index * ARC_STAGGER_MS;
  if (elapsed < 0) return null;

  return (elapsed % ARC_LIGHT_PERIOD_MS) / ARC_LIGHT_PERIOD_MS;
}

/** The light fades in and out over the first and last of its journey. */
export function arcLightOpacity(fraction: number): number {
  const edge = 0.08;
  return Math.min(1, fraction / edge, (1 - fraction) / edge);
}

/** Below this width the hero is a phone's: a big planet bleeding off both sides. */
export const PHONE_MAX_WIDTH = 640;
/** From this width the planet sits right of centre and the copy has the left. */
export const WIDE_MIN_WIDTH = 1024;

/**
 * How big the planet is in the hero, in pixels across.
 *
 * Three compositions. From 1024px the planet is right of centre and large,
 * `min(96vh, 62vw)`, and is allowed to run off the bottom of the hero. In
 * between it is centred, `min(92vh, 78vw)`. On a phone it is `118vw`, so it
 * bleeds off both sides.
 */
export function heroDiameter(width: number, height: number): number {
  if (width < PHONE_MAX_WIDTH) return width * 1.18;
  if (width < WIDE_MIN_WIDTH) return Math.min(height * 0.92, width * 0.78);
  return Math.min(height * 0.96, width * 0.62);
}

/** How many price labels the globe shows at once: five on a screen, three on a phone. */
export function labelLimit(viewportWidth: number): number {
  return viewportWidth < PHONE_MAX_WIDTH ? 3 : 5;
}

/**
 * Which side of its pin a label reads on.
 *
 * The label sits beside its dot. It turns round - to the left of the dot - when
 * on the right it would run past the edge of the screen (or of its box), and
 * stays where it is when turning round would run off the other side, because a
 * label cut off on one side is no better than one cut off on the other.
 * Returns true for "read leftwards".
 */
export function labelFlips(input: {
  /** Where the dot is. */
  readonly anchorX: number;
  readonly labelWidth: number;
  readonly boxLeft: number;
  readonly boxRight: number;
  readonly viewportWidth: number;
  readonly margin?: number;
  /**
   * The home airport is to the right of this pin, so its arc leaves to the
   * right: the label goes on the other side of the pin, away from the arc.
   */
  readonly preferLeft?: boolean;
}): boolean {
  const margin = input.margin ?? 8;
  const right = Math.min(input.boxRight, input.viewportWidth) - margin;
  const left = Math.max(input.boxLeft, 0) + margin;

  const overflowsRight = input.anchorX + input.labelWidth > right;
  const fitsLeft = input.anchorX - input.labelWidth >= left;

  // Away from the arc when there is room, and always off the edge of the screen.
  return (input.preferLeft === true || overflowsRight) && fitsLeft;
}

/**
 * Whether a price label is shown: all of it or none of it.
 *
 * A label near the limb used to fade, and half-faded labels read as ghosts. It
 * is fully there while its place faces the viewer squarely enough, and gone
 * the moment it does not.
 */
export function labelShown(cosine: number): boolean {
  return cosine >= 0.25;
}

/** Whether a box lies wholly inside another, so a label is never cut by an edge. */
export function insideBox(
  inner: {
    readonly left: number;
    readonly right: number;
    readonly top: number;
    readonly bottom: number;
  },
  outer: {
    readonly left: number;
    readonly right: number;
    readonly top: number;
    readonly bottom: number;
  },
): boolean {
  return (
    inner.left >= outer.left &&
    inner.right <= outer.right &&
    inner.top >= outer.top &&
    inner.bottom <= outer.bottom
  );
}

/** Whether an arc's key belongs to a destination: its own arc, or its branch of a trunk. */
export function arcMatchesDestination(key: string, destination: string): boolean {
  return key.startsWith(`${destination}-`) || key.endsWith(`-${destination}-branch`);
}

/** How long the other arcs take to fade out when one is selected. */
export const ARC_FADE_MS = 220;

/**
 * What an arc's opacity is heading for.
 *
 * With nothing selected every arc is shown. With a destination selected only
 * its own arc is - unless it has none to show (a destination with no route
 * drawn), in which case hiding everything would leave the globe blank.
 */
export function arcTargetOpacity(
  keys: readonly string[],
  key: string,
  selected: string | null,
): 0 | 1 {
  if (selected === null) return 1;
  if (!keys.some((candidate) => arcMatchesDestination(candidate, selected))) return 1;

  return arcMatchesDestination(key, selected) ? 1 : 0;
}

/**
 * The destinations whose price changed since the traveller last saw them.
 *
 * `seen` is what was stored last time: null when nothing was, which is a first
 * visit and pulses nothing - a pin that is new to you has not changed. Compared
 * as the strings the server formatted; nothing here reads a figure.
 */
export function changedPins(
  seen: Readonly<Record<string, string>> | null,
  now: ReadonlyArray<{ readonly destination: string; readonly label: string }>,
): string[] {
  if (!seen) return [];

  return now
    .filter((pin) => pin.label !== '' && seen[pin.destination] !== undefined)
    .filter((pin) => seen[pin.destination] !== pin.label)
    .map((pin) => pin.destination);
}

/**
 * Events the destination rail uses to point the camera at a pin.
 *
 * The rail is server-rendered markup beside the globe, not a child of it, so
 * the two talk through the window rather than through props. Both are optional:
 * with no listener the rail is simply a list of links.
 */
export const GLOBE_FOCUS_EVENT = 'voyagr:globe-focus';
export const GLOBE_RELEASE_EVENT = 'voyagr:globe-release';

/** Fired by the stage host when the page's box for the globe may have moved within the canvas. */
export const STAGE_FRAME_EVENT = 'voyagr:stage-frame';
