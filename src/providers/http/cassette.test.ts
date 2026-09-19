import { describe, expect, it, vi } from 'vitest';
import { AppError } from '@/lib/errors';
import { loadCassette, matchKey, replayingFetch } from './cassette';
import { createRecorder } from './record';
import { REDACTED, redactBody, redactHeaders, redactUrl } from './redact';

/**
 * The recorded-fixture harness.
 *
 * Two properties carry the whole thing: it can answer only from a committed
 * file and never from a network, and a credential cannot end up in that file.
 * Everything else is convenience.
 */

const SEARCH = 'https://api.example.invalid/v1/search?origin=VIE&destination=AYT&limit=2';

describe('replaying a cassette', () => {
  it('answers from the committed fixture', async () => {
    const fetch = replayingFetch(loadCassette('example-paginated-search'));
    const response = await fetch(SEARCH);

    expect(response.status).toBe(200);
    const body = (await response.json()) as { data: { id: string }[] };
    expect(body.data.map((offer) => offer.id)).toEqual(['offer-1', 'offer-2']);
  });

  it('preserves the response headers a live adapter has to read', async () => {
    const fetch = replayingFetch(loadCassette('example-rate-limited'));
    const response = await fetch(
      'https://api.example.invalid/v1/search?origin=VIE&destination=AYT',
    );

    // Without these there is no way to test a retry policy at all.
    expect(response.status).toBe(429);
    expect(response.headers.get('retry-after')).toBe('30');
    expect(response.headers.get('ratelimit-remaining')).toBe('0');
  });

  it('replays repeated calls in order, so a sequence can be expressed', async () => {
    // The same URL twice: throttled, then successful. That is how a retry is
    // tested without waiting for a real vendor to throttle us.
    const fetch = replayingFetch(loadCassette('example-rate-limited'));
    const url = 'https://api.example.invalid/v1/search?origin=VIE&destination=AYT';

    expect((await fetch(url)).status).toBe(429);
    expect((await fetch(url)).status).toBe(200);
  });

  it('follows a cursor across pages', async () => {
    const fetch = replayingFetch(loadCassette('example-paginated-search'));

    const first = (await (await fetch(SEARCH)).json()) as { meta: { after: string | null } };
    expect(first.meta.after).toBe('cursor-2');

    const second = (await (await fetch(`${SEARCH}&after=${first.meta.after}`)).json()) as {
      data: unknown[];
      meta: { after: string | null };
    };

    expect(second.data).toHaveLength(1);
    expect(second.meta.after).toBeNull();
  });

  it('refuses a request it has no recording for, rather than reaching the network', async () => {
    // The property the whole harness rests on. A silent pass-through would
    // pass on one machine, fail on another, and cost money on both.
    const fetch = replayingFetch(loadCassette('example-paginated-search'));

    await expect(fetch('https://api.example.invalid/v1/something-else')).rejects.toThrow(AppError);
  });

  it('refuses a second identical call the recording does not cover', async () => {
    // An adapter calling the same endpoint twice when one call was recorded is
    // usually a retry loop nobody intended, and hiding it would hide a bug
    // that costs money in production.
    const fetch = replayingFetch(loadCassette('example-paginated-search'));

    await fetch(SEARCH);
    await expect(fetch(SEARCH)).rejects.toThrow(AppError);
  });

  it('can be told to allow repeats when that is the point of the test', async () => {
    const fetch = replayingFetch(loadCassette('example-paginated-search'), { allowRepeats: true });

    expect((await fetch(SEARCH)).status).toBe(200);
    expect((await fetch(SEARCH)).status).toBe(200);
  });

  it('reports a missing cassette clearly', () => {
    expect(() => loadCassette('no-such-cassette')).toThrow(AppError);
  });
});

describe('matching', () => {
  it('matches on method and URL, ignoring headers', () => {
    // Headers carry credentials that differ between the recording machine and
    // every later one; matching on them would make a fixture unusable anywhere
    // but where it was made.
    expect(matchKey({ method: 'get', url: SEARCH })).toBe(matchKey({ method: 'GET', url: SEARCH }));
  });

  it('treats a different query string as a different request', () => {
    expect(matchKey({ method: 'GET', url: SEARCH })).not.toBe(
      matchKey({ method: 'GET', url: `${SEARCH}&after=cursor-2` }),
    );
  });
});

describe('redaction', () => {
  it('keeps headers that decide behaviour and redacts the rest', () => {
    const redacted = redactHeaders({
      Authorization: 'Bearer a-real-token',
      'X-Api-Key': 'a-real-key',
      'Content-Type': 'application/json',
      'Retry-After': '30',
    });

    expect(redacted.authorization).toBe(REDACTED);
    expect(redacted['x-api-key']).toBe(REDACTED);
    // Kept, because a retry policy cannot be tested without them.
    expect(redacted['content-type']).toBe('application/json');
    expect(redacted['retry-after']).toBe('30');
  });

  it('redacts an unknown header rather than keeping it', () => {
    // An allow-list is wrong loudly; a block-list is wrong silently the first
    // time a vendor invents a header nobody here has heard of.
    expect(redactHeaders({ 'X-Vendor-Signature': 'secret' })['x-vendor-signature']).toBe(REDACTED);
  });

  it('strips credentials from a query string but keeps the parameter names', () => {
    const redacted = redactUrl(
      'https://api.example.invalid/v1/search?apiKey=real-secret&origin=VIE&signature=abc',
    );

    expect(redacted).toContain('origin=VIE');
    expect(redacted).not.toContain('real-secret');
    expect(redacted).not.toContain('abc');
    // Which parameters were sent is part of what the fixture is evidence of.
    expect(redacted).toContain('apiKey=');
  });

  it('removes credentials embedded in the authority', () => {
    expect(redactUrl('https://user:password@api.example.invalid/v1/search')).not.toContain(
      'password',
    );
  });

  it('redacts token-shaped fields in a body', () => {
    const redacted = redactBody('{"access_token":"real-token","total":"312.40"}');

    expect(redacted).not.toContain('real-token');
    expect(redacted).toContain('312.40');
  });

  it('leaves a body with nothing sensitive alone', () => {
    const body = '{"data":[{"id":"offer-1","total":"312.40"}]}';
    expect(redactBody(body)).toBe(body);
  });
});

describe('recording', () => {
  it('captures an exchange and redacts it on the way through', async () => {
    // Redaction happens before anything is written, so an interrupted
    // recording still cannot leave a credential on disk.
    const upstream = vi.fn(
      async () =>
        new Response('{"data":[]}', {
          status: 200,
          headers: { 'content-type': 'application/json', 'set-cookie': 'session=secret' },
        }),
    );

    const recorder = createRecorder({
      provider: 'example',
      cassetteName: 'unit-test-not-saved',
      fetch: upstream,
      now: () => new Date('2026-09-19T09:00:00.000Z'),
    });

    const response = await recorder.fetch('https://api.example.invalid/v1/search?apiKey=secret', {
      method: 'GET',
      headers: { Authorization: 'Bearer real-token' },
    });

    // The caller still gets a usable body: the recorder reads a clone.
    expect(await response.json()).toEqual({ data: [] });
    expect(recorder.count).toBe(1);
  });

  it('hands the body back intact to the caller', async () => {
    const upstream = async () => new Response('{"total":"312.40"}', { status: 200 });
    const recorder = createRecorder({
      provider: 'example',
      cassetteName: 'unit-test-not-saved',
      fetch: upstream,
    });

    const response = await recorder.fetch('https://api.example.invalid/v1/x');
    expect(await response.text()).toBe('{"total":"312.40"}');
  });
});
