import places from '../../../public/geo/places.v2.json';

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

const AIRPORTS = (places as { features: readonly PlaceFeature[] }).features
  .filter(
    (feature) =>
      feature.properties.kind === 'airport' &&
      typeof feature.properties.iata === 'string' &&
      /^[A-Z]{3}$/.test(feature.properties.iata),
  )
  .map((feature) => ({ code: feature.properties.iata!, name: feature.properties.name }))
  .sort((a, b) => a.name.localeCompare(b.name));

export function MorePlaces() {
  return (
    <nav aria-label="More places on the globe" className="sr-only">
      <ul>
        {AIRPORTS.map((airport) => (
          <li key={airport.code}>
            <a href={`/?edit=1&destinations=${airport.code}`} tabIndex={-1}>
              See prices for {airport.name} ({airport.code})
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
