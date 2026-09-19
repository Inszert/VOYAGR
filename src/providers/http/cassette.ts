import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { AppError } from '@/lib/errors';
import { redactBody, redactHeaders, redactUrl } from './redact';
import type { Cassette, FetchLike, RecordedExchange, RecordedRequest } from './types';

/**
 * Reading, writing and replaying cassettes.
 *
 * Replay is strict: a request the cassette does not hold is an error, never a
 * silent pass-through to the network. A test suite that quietly reached a
 * vendor when a fixture was missing would pass on one machine, fail on
 * another, and cost money on both.
 */

export const CASSETTE_DIR = join('tests', 'fixtures', 'providers');

function cassettePath(name: string): string {
  return join(CASSETTE_DIR, `${name}.json`);
}

export function loadCassette(name: string): Cassette {
  const path = cassettePath(name);

  if (!existsSync(path)) {
    throw new AppError('NOT_FOUND', `No cassette at ${path}`, {
      publicMessage: 'A test fixture is missing.',
    });
  }

  return JSON.parse(readFileSync(path, 'utf8')) as Cassette;
}

export function saveCassette(cassette: Cassette): string {
  const path = cassettePath(cassette.name);
  mkdirSync(dirname(path), { recursive: true });

  // Pretty-printed and trailing-newlined so a fixture reviews as a diff rather
  // than as one unreadable line.
  writeFileSync(path, `${JSON.stringify(cassette, null, 2)}\n`, 'utf8');
  return path;
}

/**
 * What makes two requests "the same request".
 *
 * Method and URL, with the query string, because that is what decides which
 * page of which search a response belongs to. Headers are deliberately not part
 * of it: they carry credentials that differ between the recording machine and
 * every later one, and matching on them would make every fixture unusable
 * outside the machine that made it.
 */
export function matchKey(request: Pick<RecordedRequest, 'method' | 'url'>): string {
  return `${request.method.toUpperCase()} ${redactUrl(request.url)}`;
}

export interface ReplayOptions {
  /**
   * Allow a cassette to answer the same request more than once.
   *
   * Off by default: an adapter that calls the same endpoint twice when the
   * fixture recorded one call is usually a retry loop nobody intended, and a
   * harness that hid it would hide a bug that costs money in production.
   */
  readonly allowRepeats?: boolean;
}

/**
 * A `fetch` that answers only from a cassette.
 *
 * Offline by construction. It has no network access of any kind: a request
 * without a recording throws rather than reaching a vendor.
 */
export function replayingFetch(cassette: Cassette, options: ReplayOptions = {}): FetchLike {
  const remaining = new Map<string, RecordedExchange[]>();

  for (const exchange of cassette.exchanges) {
    const key = matchKey(exchange.request);
    const queue = remaining.get(key);
    if (queue) queue.push(exchange);
    else remaining.set(key, [exchange]);
  }

  return async function fetchFromCassette(url: string, init: RequestInit = {}) {
    const key = matchKey({ method: init.method ?? 'GET', url });
    const queue = remaining.get(key);

    if (!queue || queue.length === 0) {
      throw new AppError(
        'NOT_FOUND',
        `Cassette "${cassette.name}" has no recording for ${key}. ` +
          'Re-record it, or fix the request. This harness never reaches the network.',
        { publicMessage: 'A test fixture is missing.', context: { cassette: cassette.name } },
      );
    }

    // Ordered playback: a second call to the same URL gets the second
    // recording, which is how a paginated sequence and a price that moved
    // between calls are both expressed.
    const exchange = queue.length === 1 && options.allowRepeats ? queue[0]! : queue.shift()!;

    return new Response(exchange.response.body, {
      status: exchange.response.status,
      statusText: exchange.response.statusText,
      headers: exchange.response.headers,
    });
  };
}

/** Requests a cassette holds that nothing asked for. Useful at the end of a test. */
export function unusedExchanges(cassette: Cassette, used: readonly string[]): string[] {
  const seen = new Set(used);
  return cassette.exchanges
    .map((exchange) => matchKey(exchange.request))
    .filter((key) => !seen.has(key));
}

export { redactBody, redactHeaders, redactUrl };
