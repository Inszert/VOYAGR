import type { GeoPosition, StayOffer, StayProperty } from './types';

/**
 * Deciding when two providers are describing the same building.
 *
 * Merging is the whole point of a metasearch and it is also the thing most
 * worth being careful about. Showing one hotel three times is untidy;
 * **merging two different hotels is a lie about where somebody will sleep**,
 * and it is not recoverable by the user - they cannot tell it happened.
 *
 * So the rule is deliberately conservative: merge only on evidence, and when
 * the evidence is weak, leave them apart. An unmerged duplicate is a visible
 * annoyance. A wrong merge is an invisible fault.
 */

/** Roughly a hundred metres, in degrees of latitude. */
const CLOSE_DEGREES = 0.001;

/**
 * Metres between two points, by the equirectangular approximation.
 *
 * Exact enough at hotel distances - the error against the great circle is
 * under a metre at a kilometre - and it avoids the trigonometric cost of
 * Haversine for a comparison run over every pair in a result set.
 */
export function metresBetween(a: GeoPosition, b: GeoPosition): number {
  const meanLatitude = ((a.latitude + b.latitude) / 2) * (Math.PI / 180);
  const x = (b.longitude - a.longitude) * Math.cos(meanLatitude);
  const y = b.latitude - a.latitude;

  // 111,320 metres per degree of latitude.
  return Math.hypot(x, y) * 111_320;
}

/**
 * A name reduced to what is actually distinguishing.
 *
 * Providers publish "Hotel Arts Barcelona", "HOTEL ARTS BARCELONA" and
 * "Hotel Arts, Barcelona" for one building. Case, punctuation and accents go;
 * the words stay, because dropping "Hotel" would collapse two genuinely
 * different properties that differ only by their type.
 */
export function normaliseName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * How confident we are that two properties are one property.
 *
 * `same` is only reached on coordinates, because a name match alone is not
 * evidence: chains repeat names across a city, and "Ibis Barcelona" is four
 * different buildings.
 */
export type IdentityConfidence = 'same' | 'possible' | 'different';

export function compareProperties(a: StayProperty, b: StayProperty): IdentityConfidence {
  const sameName = normaliseName(a.name) === normaliseName(b.name);

  if (a.position && b.position) {
    const metres = metresBetween(a.position, b.position);

    /*
     * Close together and identically named is the only thing treated as
     * certain. Two hotels of the same name a hundred metres apart is not a
     * thing that happens; the same hotel plotted a hundred metres apart by
     * two providers happens constantly.
     */
    if (metres <= 150 && sameName) return 'same';

    // Same name, same neighbourhood: plausible, and not acted on.
    if (metres <= 1_000 && sameName) return 'possible';

    // Different names, or far apart: two buildings.
    return 'different';
  }

  /*
   * Without coordinates there is no evidence strong enough to merge on.
   * A matching name and city is reported as possible and left unmerged,
   * which is the safe direction to be wrong in.
   */
  if (sameName && a.address.city && a.address.city === b.address.city) return 'possible';

  return 'different';
}

/**
 * A stable key for grouping, when coordinates are available.
 *
 * Rounded to about a hundred metres so two providers' slightly different
 * pins land in one bucket. Used only to avoid comparing every pair with
 * every other; `compareProperties` still decides.
 */
export function canonicalKey(property: StayProperty): string {
  if (!property.position) return `name:${normaliseName(property.name)}`;

  const lat = Math.round(property.position.latitude / CLOSE_DEGREES);
  const lon = Math.round(property.position.longitude / CLOSE_DEGREES);

  return `geo:${lat}:${lon}:${normaliseName(property.name)}`;
}

/**
 * One physical property, with every provider's offers for it.
 *
 * This is what a hotel card renders. The UI never learns which provider a
 * result "came from", because for a merged property the answer is "several".
 */
export interface CanonicalStay {
  /** Stable across a result set, derived from the first offer seen. */
  readonly key: string;
  /** The fullest description available, merged across providers. */
  readonly property: StayProperty;
  /** Every provider's offer for this property, in the order they arrived. */
  readonly offers: readonly StayOffer[];
}

/**
 * Take the richer of two values, preferring the one that exists.
 *
 * A provider that omits a description should never blank one another
 * provider supplied: merging must only ever add information.
 */
function richer<T>(a: T | null, b: T | null): T | null {
  if (a === null || a === undefined) return b ?? null;
  if (b === null || b === undefined) return a;

  if (Array.isArray(a) && Array.isArray(b)) {
    return (a.length >= b.length ? a : b) as T;
  }

  if (typeof a === 'string' && typeof b === 'string') {
    return (a.length >= b.length ? a : b) as T;
  }

  return a;
}

function mergeProperties(a: StayProperty, b: StayProperty): StayProperty {
  return {
    ...a,
    name: a.name.length >= b.name.length ? a.name : b.name,
    description: richer(a.description, b.description),
    // Photos from both, de-duplicated by URL: more angles is strictly better.
    photos: [...new Map([...a.photos, ...b.photos].map((p) => [p.url, p])).values()],
    address: {
      line: richer(a.address.line, b.address.line),
      city: richer(a.address.city, b.address.city),
      region: richer(a.address.region, b.address.region),
      postcode: richer(a.address.postcode, b.address.postcode),
      countryCode: richer(a.address.countryCode, b.address.countryCode),
    },
    position: a.position ?? b.position,
    starRating: a.starRating ?? b.starRating,
    // The rating backed by more reviews is the more useful one.
    guestRating:
      (a.guestRating?.reviewCount ?? 0) >= (b.guestRating?.reviewCount ?? 0)
        ? (a.guestRating ?? b.guestRating)
        : (b.guestRating ?? a.guestRating),
    amenities: [...new Set([...a.amenities, ...b.amenities])],
    propertyType: a.propertyType ?? b.propertyType,
  };
}

/**
 * Group offers from any number of providers into one property per building.
 *
 * Only `same` merges. `possible` is deliberately left as separate entries:
 * see the note at the top of this file about which mistake is recoverable.
 */
export function canonicalise(offers: readonly StayOffer[]): CanonicalStay[] {
  const groups: CanonicalStay[] = [];

  for (const offer of offers) {
    const match = groups.find(
      (group) => compareProperties(group.property, offer.property) === 'same',
    );

    if (!match) {
      groups.push({
        key: canonicalKey(offer.property),
        property: offer.property,
        offers: [offer],
      });
      continue;
    }

    const index = groups.indexOf(match);

    groups[index] = {
      key: match.key,
      property: mergeProperties(match.property, offer.property),
      offers: [...match.offers, offer],
    };
  }

  return groups;
}
