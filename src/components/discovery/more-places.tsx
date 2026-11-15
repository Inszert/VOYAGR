import places from '../../../public/geo/places.v2.json';
import { resolveDestinationGeo } from '@/search/destination-names';

/**
 * Every real place the globe draws as a dim dot, in words.
 *
 * The dots are canvas, and the canvas is decoration: a fact on the globe is
 * also a link in the DOM. These are those links - a few hundred airports from
 * Natural Earth, preloaded, with no price on them because none has been looked
 * up. Each one opens the search with that airport filled in, and says so:
 * "See prices", never a figure we do not have.
 *
 * Visually hidden and out of the tab order. Three hundred more tab stops would
 * bury the page for somebody using a keyboard; a screen reader's links list
 * and landmark navigation reach them, and the priced pins and cards - which
 * are the places that have an answer - stay in the ordinary order.
 */

interface PlaceFeature {
  readonly properties: { readonly kind: string; readonly name: string; readonly iata?: string };
}

/**
 * Each dot with the city and the country it is in.
 *
 * The preloaded dots (places.v2.json) carry only the airport's own name, which
 * is a poor thing to read aloud ("Cheongju Int'l"). The city and the full
 * country name come from the generated reference data the destination names
 * already use, joined on the IATA code. A code the reference does not know
 * keeps the airport's own name - a place is never given a city it was not
 * stated to have.
 */
const AIRPORTS = (places as { features: readonly PlaceFeature[] }).features
  .filter(
    (feature) =>
      feature.properties.kind === 'airport' &&
      typeof feature.properties.iata === 'string' &&
      /^[A-Z]{3}$/.test(feature.properties.iata),
  )
  .map((feature) => {
    const code = feature.properties.iata!;
    const known = resolveDestinationGeo(code);
    const city = known?.name ?? feature.properties.name;
    const country = known && known.country !== 'Unknown' ? known.country : null;

    return { code, label: country ? `${city}, ${country}` : city };
  })
  .sort((a, b) => a.label.localeCompare(b.label));

// Two airports in one city would read as the same link twice, so those two say which.
const LABEL_COUNT = new Map<string, number>();
for (const airport of AIRPORTS)
  LABEL_COUNT.set(airport.label, (LABEL_COUNT.get(airport.label) ?? 0) + 1);

export function MorePlaces() {
  return (
    <nav aria-label="More places on the globe" className="sr-only">
      <ul>
        {AIRPORTS.map((airport) => (
          <li key={airport.code}>
            <a href={`/?edit=1&destinations=${airport.code}`} tabIndex={-1}>
              See prices for {airport.label}
              {(LABEL_COUNT.get(airport.label) ?? 0) > 1 ? ` (${airport.code})` : ''}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
