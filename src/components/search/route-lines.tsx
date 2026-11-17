import { buildRoutePairs, routeCountText, routeText } from '@/discovery/search-routes';

/**
 * The lines drawn on the globe for this search, as text.
 *
 * One entry per origin-to-destination pair, so the connection is never carried
 * by the line's colour alone. Renders nothing when no line could be drawn.
 */
export function RouteLines({
  origins,
  destinations,
}: {
  origins: readonly string[];
  destinations: readonly string[];
}) {
  const result = buildRoutePairs(origins, destinations);
  if (result.pairs.length === 0) return null;

  return (
    <div className="text-ink-muted text-sm">
      <p>{routeCountText(result)}</p>
      <ul aria-label="Routes on the globe" className="flex flex-wrap gap-x-4 gap-y-1">
        {result.pairs.map((pair) => (
          <li key={`${pair.origin}-${pair.destination}`} className="tabular-nums">
            {routeText(pair)}
          </li>
        ))}
      </ul>
    </div>
  );
}
