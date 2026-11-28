import type { Bounds, StoredRoute } from '@/discovery/stored-routes';

/**
 * How the browser asks for the globe's stored routes while it moves.
 *
 * **It can only reach `/api/globe-routes`.** The path is a constant here, so a pan or a spin
 * cannot be turned into a price lookup from this file; prices are asked for by the route panel,
 * on a click. Requests are debounced, and a newer one cancels the one still in flight, so a long
 * drag costs one request, not one per frame.
 */

export const GLOBE_ROUTES_PATH = '/api/globe-routes';
export const GLOBE_ROUTES_DEBOUNCE_MS = 350;

export interface StoredRoutesLoader {
  /** Ask for the routes in a box. Replaces any earlier ask that has not finished. */
  request(origin: string, bounds: Bounds): void;
  /** Cancel everything pending. */
  dispose(): void;
}

export function createStoredRoutesLoader(options: {
  readonly onRoutes: (routes: readonly StoredRoute[]) => void;
  readonly fetcher?: typeof fetch;
  readonly debounceMs?: number;
}): StoredRoutesLoader {
  const fetcher = options.fetcher ?? ((...args) => fetch(...args));
  const debounceMs = options.debounceMs ?? GLOBE_ROUTES_DEBOUNCE_MS;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let inflight: AbortController | null = null;

  const cancel = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    inflight?.abort();
    inflight = null;
  };

  return {
    request(origin, bounds) {
      cancel();
      timer = setTimeout(() => {
        timer = null;
        const controller = new AbortController();
        inflight = controller;
        const query = new URLSearchParams({
          origin,
          west: String(bounds.west),
          south: String(bounds.south),
          east: String(bounds.east),
          north: String(bounds.north),
        });
        fetcher(`${GLOBE_ROUTES_PATH}?${query}`, { signal: controller.signal })
          .then((response) => (response.ok ? response.json() : null))
          .then((body: { routes?: StoredRoute[] } | null) => {
            if (controller.signal.aborted || !body?.routes) return;
            options.onRoutes(body.routes);
          })
          .catch(() => {
            // A failed or cancelled read leaves the arcs as they were.
          });
      }, debounceMs);
    },
    dispose: cancel,
  };
}
