import type { Page } from '@playwright/test';

/**
 * Watching what the browser actually asked for.
 *
 * Listening on the **context** rather than the page, which matters here for
 * two reasons that both cost a debugging round to find:
 *
 *  - MapLibre loads and parses GeoJSON on its worker, so a source fetch is
 *    not a page request.
 *  - The service worker caches `/geo/` and `/maplibre/` and claims the page
 *    before the globe starts building, so a request it serves never reaches a
 *    page-level listener at all.
 *
 * A page-level listener therefore reports an empty list and a test asserting
 * "this was fetched" fails for a reason that has nothing to do with the
 * product. The context sees every request from the page, its workers and its
 * service worker.
 *
 * Start it before `goto`, or the first requests are already gone.
 */
export interface RequestLog {
  /** Same-origin paths under `/geo/`, in the order they were asked for. */
  readonly geo: string[];
  /** Full URLs of anything not served by this origin. Must stay empty. */
  readonly external: string[];
  /** Every same-origin path, for the rare assertion that needs one. */
  readonly paths: string[];
}

export function watchRequests(page: Page): RequestLog {
  const log: RequestLog = { geo: [], external: [], paths: [] };

  page.context().on('request', (request) => {
    const url = new URL(request.url());
    const local = url.host.startsWith('127.0.0.1') || url.host.startsWith('localhost');

    if (!local) {
      log.external.push(request.url());
      return;
    }

    log.paths.push(url.pathname);
    if (url.pathname.startsWith('/geo/')) log.geo.push(url.pathname);
  });

  return log;
}
