import { describe, expect, it, vi } from 'vitest';
import { ResendEmailProvider } from './resend';

const KEY = 're_test_key_do_not_log';

function providerAnswering(response: Response | Error) {
  const fetch = vi.fn(async (_url: unknown, _init?: RequestInit) => {
    if (response instanceof Error) throw response;
    return response;
  });

  const provider = new ResendEmailProvider({
    apiKey: KEY,
    from: 'Voyagr <hello@voyagrfind.com>',
    replyTo: 'support@voyagrfind.com',
    fetch: fetch as unknown as typeof globalThis.fetch,
  });

  return { provider, fetch };
}

const MESSAGE = {
  to: 'traveller@example.invalid',
  subject: 'Hello',
  text: 'plain',
  html: '<p>html</p>',
  headers: { 'List-Unsubscribe': '<https://example.invalid/u>' },
};

describe('ResendEmailProvider', () => {
  it('posts the message to the Resend API with a bearer key', async () => {
    const { provider, fetch } = providerAnswering(Response.json({ id: 'abc' }, { status: 200 }));

    expect((await provider.send(MESSAGE)).ok).toBe(true);

    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe('https://api.resend.com/emails');
    expect(init?.method).toBe('POST');
    expect((init?.headers as Record<string, string>).Authorization).toBe(`Bearer ${KEY}`);

    expect(JSON.parse(init?.body as string)).toEqual({
      from: 'Voyagr <hello@voyagrfind.com>',
      to: ['traveller@example.invalid'],
      subject: 'Hello',
      text: 'plain',
      html: '<p>html</p>',
      reply_to: 'support@voyagrfind.com',
      headers: { 'List-Unsubscribe': '<https://example.invalid/u>' },
    });
  });

  it('omits html, reply_to and headers when there are none', async () => {
    const fetch = vi.fn(async () => Response.json({ id: 'abc' }));
    const bare = new ResendEmailProvider({
      apiKey: KEY,
      from: 'a@b.invalid',
      fetch: fetch as unknown as typeof globalThis.fetch,
    });

    await bare.send({ to: 'x@y.invalid', subject: 's', text: 't' });

    const body = JSON.parse(
      (fetch.mock.calls[0] as unknown as [string, RequestInit])[1].body as string,
    );
    expect(body).not.toHaveProperty('html');
    expect(body).not.toHaveProperty('reply_to');
    expect(body).not.toHaveProperty('headers');
  });

  it('returns a retryable error for a 5xx, not an exception', async () => {
    const { provider } = providerAnswering(new Response('boom', { status: 503 }));
    const result = await provider.send(MESSAGE);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('PROVIDER_UNAVAILABLE');
      expect(result.error.retryable).toBe(true);
    }
  });

  it('treats 429 as rate limited and retryable', async () => {
    const { provider } = providerAnswering(new Response('slow down', { status: 429 }));
    const result = await provider.send(MESSAGE);

    expect(!result.ok && result.error.code).toBe('RATE_LIMITED');
  });

  it('treats a 4xx as final: sending the same thing again changes nothing', async () => {
    const { provider } = providerAnswering(new Response('bad', { status: 422 }));
    const result = await provider.send(MESSAGE);

    expect(!result.ok && result.error.code).toBe('PROVIDER_ERROR');
    expect(!result.ok && result.error.retryable).toBe(false);
  });

  it('returns a failure when the network is down', async () => {
    const { provider } = providerAnswering(new TypeError('fetch failed'));
    const result = await provider.send(MESSAGE);

    expect(!result.ok && result.error.code).toBe('PROVIDER_UNAVAILABLE');
  });

  it('gives up on a request that never answers', async () => {
    const hang = vi.fn(
      (_url: unknown, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(Object.assign(new Error('aborted'), { name: 'AbortError' })),
          );
        }),
    );
    const provider = new ResendEmailProvider({
      apiKey: KEY,
      from: 'a@b.invalid',
      timeoutMs: 20,
      fetch: hang as unknown as typeof globalThis.fetch,
    });

    const result = await provider.send(MESSAGE);

    expect(!result.ok && result.error.code).toBe('PROVIDER_TIMEOUT');
  });

  it('never puts the key or the recipient in the error it returns', async () => {
    const { provider } = providerAnswering(new Response('nope', { status: 401 }));
    const result = await provider.send(MESSAGE);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      const serialised = JSON.stringify({
        message: result.error.message,
        context: result.error.context,
      });
      expect(serialised).not.toContain(KEY);
      expect(serialised).not.toContain(MESSAGE.to);
    }
  });

  const NL = String.fromCharCode(10);
  const CRLF = String.fromCharCode(13, 10);

  it.each([
    'a@b.test, c@d.test',
    'Victim <a@b.test>',
    `a@b.test${NL}Bcc: x@y.test`,
    `a@b.test${CRLF}`,
    '"a b"@c.test',
    'no-at-sign',
    '@b.test',
    'a@',
    '',
  ])('refuses the recipient %j without calling the vendor', async (to) => {
    const { provider, fetch } = providerAnswering(Response.json({ id: 'abc' }));

    const result = await provider.send({ ...MESSAGE, to });

    expect(result.ok).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('refuses a subject or header with a line break', async () => {
    const { provider, fetch } = providerAnswering(Response.json({ id: 'abc' }));

    expect((await provider.send({ ...MESSAGE, subject: `Hi${CRLF}Bcc: x@y.test` })).ok).toBe(false);
    expect(
      (await provider.send({ ...MESSAGE, headers: { 'X-One': `a${NL}Bcc: x@y.test` } })).ok,
    ).toBe(false);
    expect((await provider.send({ ...MESSAGE, headers: { [`X-One${NL}Bcc`]: 'a' } })).ok).toBe(
      false,
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it('declares that it sends real email', () => {
    expect(new ResendEmailProvider({ apiKey: KEY, from: 'a@b.invalid' }).sendsRealEmail).toBe(true);
  });
});
