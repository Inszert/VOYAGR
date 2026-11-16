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
      { dedupeKey: 'cache.refresh:origin:LHR' },
    );
  });

  it('never throws, so a broken queue cannot fail a page', async () => {
    const enqueue = vi.fn(async () => {
      throw new Error('redis down');
    });

    await expect(requestCacheRefresh({ today: TODAY }, { enqueue })).resolves.toBeUndefined();
  });
});
