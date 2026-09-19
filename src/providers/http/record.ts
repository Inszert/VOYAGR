import { getLogger } from '@/lib/logger';
import { redactBody, redactHeaders, redactUrl } from './redact';
import { saveCassette } from './cassette';
import type { Cassette, FetchLike, RecordedExchange } from './types';

/**
 * Recording a real exchange into a cassette.
 *
 * The one piece of this harness that touches a network, and it runs only when
 * a human deliberately runs it against a sandbox with credentials in the
 * environment. Nothing in `npm test` ever calls it.
 *
 * Everything is redacted on the way through, before anything is written, so a
 * cassette cannot contain a credential even if the recording is interrupted.
 */

const log = getLogger('providers.record');

export interface RecorderOptions {
  readonly provider: string;
  readonly cassetteName: string;
  /** Defaults to the global `fetch`. Injectable so the recorder is testable. */
  readonly fetch?: FetchLike;
  readonly now?: () => Date;
}

export interface Recorder {
  /** Use this in place of `fetch` while recording. */
  readonly fetch: FetchLike;
  /** Number of exchanges captured so far. */
  readonly count: number;
  /** Write the cassette and return where it went. */
  save(note?: string): string;
}

export function createRecorder(options: RecorderOptions): Recorder {
  const underlying = options.fetch ?? globalThis.fetch;
  const now = options.now ?? (() => new Date());
  const exchanges: RecordedExchange[] = [];

  const recordingFetch: FetchLike = async (url, init = {}) => {
    const response = await underlying(url, init);

    // The body is read here and handed back as a fresh Response, because a
    // body can only be consumed once and the caller still needs it.
    const body = await response.clone().text();

    exchanges.push({
      request: {
        method: (init.method ?? 'GET').toUpperCase(),
        url: redactUrl(url),
        headers: redactHeaders(headersToObject(init.headers)),
        body: redactBody(typeof init.body === 'string' ? init.body : null),
      },
      response: {
        status: response.status,
        statusText: response.statusText,
        headers: redactHeaders(headersToObject(response.headers)),
        body: redactBody(body) ?? '',
      },
      recordedAt: now().toISOString(),
    });

    return response;
  };

  return {
    fetch: recordingFetch,
    get count() {
      return exchanges.length;
    },
    save(note) {
      const cassette: Cassette = {
        name: options.cassetteName,
        provider: options.provider,
        exchanges: note
          ? exchanges.map((exchange, index) => (index === 0 ? { ...exchange, note } : exchange))
          : exchanges,
      };

      const path = saveCassette(cassette);

      // Redaction is best effort on a body whose shape belongs to a vendor.
      // The file is evidence that will be committed; somebody reads it first.
      log.warn(
        { path, exchanges: exchanges.length },
        'cassette written — READ IT before committing; body redaction cannot be exhaustive',
      );

      return path;
    },
  };
}

function headersToObject(headers: HeadersInit | Headers | undefined): Record<string, string> {
  if (!headers) return {};

  if (headers instanceof Headers) {
    return Object.fromEntries([...headers.entries()]);
  }

  if (Array.isArray(headers)) {
    return Object.fromEntries(headers);
  }

  return { ...(headers as Record<string, string>) };
}
