import type { NearbyOrigin } from '@/search/destination-names';

/**
 * Departure airports near the ones searched, one click from being added.
 *
 * Straight-line distances, said as such. Nothing here claims a nearby
 * airport is cheaper; adding one runs the search again with it included, and
 * the answer is whatever that search finds.
 */
export function NearbyAirportsPanel({
  airports,
  hrefFor,
}: {
  airports: readonly NearbyOrigin[];
  hrefFor: (code: string) => string;
}) {
  if (airports.length === 0) return null;

  return (
    <section aria-labelledby="nearby-heading" className="flex flex-col gap-3">
      <h2 id="nearby-heading" className="font-display text-ink text-xl">
        Also fly from
      </h2>
      <p className="text-ink-muted text-sm">
        Airports near where you are leaving from, as the crow flies. Adding one searches again with
        it included.
      </p>
      <ul className="flex flex-wrap gap-2">
        {airports.map((airport) => (
          <li key={airport.code}>
            <a
              href={hrefFor(airport.code)}
              className="border-border-strong text-ink hover:border-tint-ink hover:text-tint-ink ease-standard duration-quick inline-flex items-center gap-1.5 rounded-(--radius-pill) border px-3 py-1.5 text-sm transition-colors"
            >
              <span className="font-semibold">{airport.code}</span>
              <span className="text-ink-muted">
                {airport.name}, {airport.km} km
              </span>
              <span className="sr-only">: add to the search</span>
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
