import { describe, expect, it } from 'vitest';
import { cacheKey } from './key';
import { MemoryCacheStore } from './memory';

describe('MemoryCacheStore', () => {
  it('returns what was set, stamped with the store clock', async () => {
    let at = Date.parse('2026-11-14T12:00:00.000Z');
    const store = new MemoryCacheStore({ now: () => at });

    await store.set('k', { n: 1 }, { ttlMs: 1000 });
    at += 500;

    expect(await store.get('k')).toEqual({
      value: { n: 1 },
      observedAt: '2026-11-14T12:00:00.000Z',
    });
  });

  it('expires at exactly the ttl, and not a millisecond before', async () => {
    let at = 1_000_000;
    const store = new MemoryCacheStore({ now: () => at });
    await store.set('k', 'v', { ttlMs: 1000 });

    at += 999;
    expect(await store.get('k')).not.toBeNull();

    at += 1;
    expect(await store.get('k')).toBeNull();
    expect(store.size).toBe(0);
  });

  it('returns null for a key it never had', async () => {
    expect(await new MemoryCacheStore().get('nope')).toBeNull();
  });

  it('evicts the least recently used entry past its bound', async () => {
    const store = new MemoryCacheStore({ maxEntries: 2 });
    await store.set('a', 1, { ttlMs: 1000 });
    await store.set('b', 2, { ttlMs: 1000 });
    await store.get('a');
    await store.set('c', 3, { ttlMs: 1000 });

    expect(await store.get('b')).toBeNull();
    expect(await store.get('a')).not.toBeNull();
    expect(await store.get('c')).not.toBeNull();
  });
});

describe('cacheKey', () => {
  it('has the documented shape and is stable whatever the key order', () => {
    const a = cacheKey('search', { x: 1, y: [1, 2] });
    const b = cacheKey('search', { y: [1, 2], x: 1 });

    expect(a).toBe(b);
    expect(a).toMatch(/^voyagr:v1:search:[0-9a-f]{32}$/);
  });

  it('separates kinds and queries', () => {
    expect(cacheKey('search', { x: 1 })).not.toBe(cacheKey('discovery', { x: 1 }));
    expect(cacheKey('search', { x: 1 })).not.toBe(cacheKey('search', { x: 2 }));
  });
});
