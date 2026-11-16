import catalogue from '../../../public/geo/label-places.v1.json';
import { parseLabelPlaces, type LabelPlace } from '@/components/discovery/globe-labels';
import { resolveDestinationGeo } from '@/search/destination-names';

/**
 * Where a stays search is: the city's own centre, never its runway.
 *
 * The stays page is reached with a typed city name ("Barcelona") or the code
 * a trip handed over ("BCN"). Both are resolved against the generated place
 * catalogue (`scripts/build-geo.mjs --only=label-places`), whose position for
 * a city is Natural Earth's city point rather than the airport's - "1.2 km
 * from the centre" measured from an airport ten kilometres out would be a false
 * claim. A code the catalogue does not hold falls back to the destination's
 * own reference position; a name it does not hold resolves to nothing, and
 * the page says so instead of guessing.
 */

export interface StayPlace {
  readonly code: string | null;
  readonly city: string;
  readonly country: string | null;
  readonly centre: { readonly latitude: number; readonly longitude: number };
}

const PLACES = parseLabelPlaces(catalogue);

/** Case and accents do not distinguish a city someone typed: "Malaga" is Málaga. */
function fold(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .trim()
    .toLowerCase();
}

function fromPlace(place: LabelPlace): StayPlace {
  return {
    code: place.code,
    city: place.city,
    country: place.country,
    centre: { latitude: place.lat, longitude: place.lng },
  };
}

export function resolveStayPlace(input: {
  readonly code: string | null;
  readonly name: string | null;
}): StayPlace | null {
  const code = input.code?.trim().toUpperCase() || null;
  if (code) {
    const place = PLACES.find((candidate) => candidate.code === code);
    if (place) return fromPlace(place);

    const geo = resolveDestinationGeo(code);
    if (geo) {
      return {
        code,
        city: input.name?.trim() || geo.name,
        country: geo.country === 'Unknown' ? null : geo.country,
        centre: { latitude: geo.position[1], longitude: geo.position[0] },
      };
    }
  }

  const name = input.name ? fold(input.name.split(',')[0] ?? '') : '';
  if (!name) return null;

  // The largest city of that name: Barcelona is Spain's before it is Venezuela's.
  const best = PLACES.filter((place) => fold(place.city) === name).sort(
    (a, b) => b.population - a.population,
  )[0];

  return best ? fromPlace(best) : null;
}
