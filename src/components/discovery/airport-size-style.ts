import sizes from '@/discovery/airport-sizes.generated.json';

/**
 * How an airport's size is drawn on a map: three colours from the stage tokens and three
 * dot sizes, so the difference never rests on colour alone, and the words the legend uses.
 *
 * `colorToken` names a `GlobeColors` key (resolved from `--color-stage-*` by the stage);
 * `cssVar` is the same token for HTML. A size nobody stated is the medium style.
 */
export type AirportSizeClass = 'large' | 'medium' | 'small';

export interface AirportSizeStyle {
  readonly size: AirportSizeClass;
  readonly label: string;
  readonly colorToken: 'origin' | 'accent' | 'chip';
  readonly cssVar: string;
  /** Multiplier on the base dot radius. */
  readonly radiusScale: number;
  /** Ring width in px around the dot; only the large airport has one. */
  readonly ring: number;
}

export const AIRPORT_SIZE_STYLES: Readonly<Record<AirportSizeClass, AirportSizeStyle>> = {
  large: {
    size: 'large',
    label: 'Large airport',
    colorToken: 'origin',
    cssVar: '--color-stage-origin',
    radiusScale: 1.7,
    ring: 1,
  },
  medium: {
    size: 'medium',
    label: 'Medium airport',
    colorToken: 'accent',
    cssVar: '--color-stage-accent',
    radiusScale: 1,
    ring: 0,
  },
  small: {
    size: 'small',
    label: 'Small airport',
    colorToken: 'chip',
    cssVar: '--color-stage-chip',
    radiusScale: 0.65,
    ring: 0,
  },
};

/** The style for a size; anything not stated falls back to medium. */
export function airportSizeStyle(size: string | null | undefined): AirportSizeStyle {
  return size === 'large' || size === 'small'
    ? AIRPORT_SIZE_STYLES[size]
    : AIRPORT_SIZE_STYLES.medium;
}

const LARGE = sizes.large as readonly string[];
const SMALL = sizes.small as readonly string[];

/** An airport's size from its IATA code; unlisted codes (and no code) are medium. */
export function airportSizeOf(iata: string | null | undefined): AirportSizeClass {
  if (!iata) return 'medium';
  if (LARGE.includes(iata)) return 'large';
  if (SMALL.includes(iata)) return 'small';
  return 'medium';
}

type Expr = unknown[];

/**
 * A MapLibre expression choosing a value by airport size. Reads a `size` property when a
 * feature carries one, else the IATA code against the generated lists, else medium.
 */
export function bySize<T extends string | number>(pick: (style: AirportSizeStyle) => T): Expr {
  const large = pick(AIRPORT_SIZE_STYLES.large);
  const small = pick(AIRPORT_SIZE_STYLES.small);
  const medium = pick(AIRPORT_SIZE_STYLES.medium);
  const size: Expr = [
    'coalesce',
    ['get', 'size'],
    [
      'case',
      ['in', ['get', 'iata'], ['literal', LARGE]],
      'large',
      ['in', ['get', 'iata'], ['literal', SMALL]],
      'small',
      'medium',
    ],
  ];
  return ['match', size, 'large', large, 'small', small, medium];
}
