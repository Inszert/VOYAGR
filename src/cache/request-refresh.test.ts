import { describe, expect, it, vi } from 'vitest';
import { requestCacheRefresh, targetIdFor } from './request-refresh';

const TODAY = '2026-11-15';

describe('targetIdFor', () => {
  it('maps the anonymous front page to the recommended target', () => {
    expect(targetIdFor({ today: TODAY })).toBe('recommended');
  });

  it('maps a popular origin to its own target', () => {
    expect(targetIdFor({ today: TODAY, defaults: { origins: 'LHR' } })).toBe('origin:LHR');
  });

  it('maps a visitor with settings no target covers to the default profile', () => {
    expect(targetIdFor({ today: TODAY, defaults: { origins: 'BTS', passengers: '4' } })).toBe(
      'recommended',
    );
  });
});

describe('requestCacheRefresh', () => {
  it('enqueues the worker’s own job under the worker’s own dedupe key', async () => {
    const enqueue = vi.fn(async () => 'id');

    await requestCacheRefresh({ today: TODAY, defaults: { origins: 'LHR' } }, { enqueue });

    expect(enqueue).toHaveBeenCalledWith(
      'cache.refresh',
      { targetId: 'origin:LHR' },
      { dedupeKey: expect.stringMatching(/^cache\.refresh:origin:LHR:\d+$/) },
    );
  });

  it('uses a new job id in a later window, so a retained completed job cannot swallow the request', async () => {
    const enqueue = vi.fn(async () => 'id');
    const input = { today: TODAY, defaults: { origins: 'LHR' } };

    await requestCacheRefresh(input, { enqueue }, () => 0);
    await requestCacheRefresh(input, { enqueue }, () => 20 * 60_000);
    await requestCacheRefresh(input, { enqueue }, () => 20 * 60_000 + 1);

    const keys = enqueue.mock.calls.map((call) => (call as unknown[])[2] as { dedupeKey: string });
    expect(keys[0]!.dedupeKey).not.toBe(keys[1]!.dedupeKey);
    expect(keys[1]!.dedupeKey).toBe(keys[2]!.dedupeKey);
  });

  it('never throws, so a broken queue cannot fail a page', async () => {
    const enqueue = vi.fn(async () => {
      throw new Error('redis down');
    });

    await expect(requestCacheRefresh({ today: TODAY }, { enqueue })).resolves.toBeUndefined();
  });
});
