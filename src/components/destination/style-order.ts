import type { ThingKind } from '@/providers/types';

/**
 * Trip style: a way to put the places a traveller is likely to want first.
 *
 * It only reorders. Nothing is removed or hidden, and a kind that a style does
 * not name keeps its current order after the ones it does.
 */

export const TRIP_STYLES = ['chill', 'hike', 'city', 'food'] as const;
export type TripStyle = (typeof TRIP_STYLES)[number];

export const STYLE_WORDS: Readonly<Record<TripStyle, string>> = {
  chill: 'Chill',
  hike: 'Hike',
  city: 'City',
  food: 'Food',
};

/** The kinds each style brings forward, most wanted first. */
export const STYLE_KIND_ORDER: Readonly<Record<TripStyle, readonly ThingKind[]>> = {
  chill: ['beaches', 'outdoors', 'culture'],
  hike: ['outdoors', 'sights'],
  city: ['sights', 'museums', 'culture', 'neighbourhoods'],
  food: ['food', 'neighbourhoods'],
};

/** A `?style=` value, or null when it is absent or not one of the four. */
export function parseStyle(value: string | string[] | undefined | null): TripStyle | null {
  const text = Array.isArray(value) ? value[0] : value;

  return TRIP_STYLES.find((style) => style === text) ?? null;
}

/**
 * The same places, those of the style's kinds first (in the style's order),
 * the rest after in their existing order. Stable within a kind; a new array.
 */
export function orderByStyle<T extends { readonly kind: ThingKind }>(
  places: readonly T[],
  style: TripStyle | null,
): T[] {
  if (style === null) return [...places];
  const wanted = STYLE_KIND_ORDER[style];
  const rank = (place: T): number => {
    const index = wanted.indexOf(place.kind);

    return index === -1 ? wanted.length : index;
  };

  return places
    .map((place, position) => ({ place, position }))
    .sort((a, b) => rank(a.place) - rank(b.place) || a.position - b.position)
    .map(({ place }) => place);
}

/** An address with `style` set (or removed), every other parameter and the hash kept. */
export function withStyleParam(href: string, style: TripStyle | null): string {
  const hashAt = href.indexOf('#');
  const hash = hashAt === -1 ? '' : href.slice(hashAt);
  const head = hashAt === -1 ? href : href.slice(0, hashAt);
  const params = new URLSearchParams(head.startsWith('?') ? head.slice(1) : head);
  if (style) params.set('style', style);
  else params.delete('style');
  const text = params.toString();

  return `${text ? `?${text}` : '?'}${hash}`;
}
