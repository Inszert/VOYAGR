import { describe, expect, it, vi } from 'vitest';
import { RedisCacheStore, type RedisLike } from './redis';

/** A Redis that is a Map, recording the TTLs it was given. */
function fakeRedis() {
  const data = new Map<string, string>();
  const ttls = new Map<string, number>();
  const client: RedisLike = {
    get: vi.fn(async (key: string) => data.get(key) ?? null),
    set: vi.fn(async (key: string, value: string, _mode: 'PX', ttlMs: number) => {
      data.set(key, value);
      ttls.set(key, ttlMs);
      return 'OK';
    }),
  };

  return { client, data, ttls };
}

const NOW = Date.parse('2026-11-14T12:00:00.000Z');

describe('RedisCacheStore', () => {
  it('round-trips a value as JSON with its observedAt and a PX ttl', async () => {
    const { client, ttls } = fakeRedis();
    const store = new RedisCacheStore(
      async () => client,
      () => NOW,
    );

    const written = await store.set(
      'k',
      { price: { amount: 12900, currency: 'EUR' } },
      { ttlMs: 5000 },
    );

    expect(written.observedAt).toBe('2026-11-14T12:00:00.000Z');
    expect(ttls.get('k')).toBe(5000);
    expect(await store.get('k')).toEqual({
      value: { price: { amount: 12900, currency: 'EUR' } },
      observedAt: '2026-11-14T12:00:00.000Z',
    });
  });

  it('returns null for a missing key', async () => {
    const { client } = fakeRedis();

    expect(await new RedisCacheStore(async () => client).get('nope')).toBeNull();
  });

  it('never gives Redis a zero or fractional ttl', async () => {
    const { client, ttls } = fakeRedis();
    const store = new RedisCacheStore(
      async () => client,
      () => NOW,
    );

    await store.set('a', 1, { ttlMs: 0 });
    await store.set('b', 1, { ttlMs: 1.2 });

    expect(ttls.get('a')).toBe(1);
    expect(ttls.get('b')).toBe(2);
  });

  it('reads a corrupt entry as a miss', async () => {
    const { client, data } = fakeRedis();
    const store = new RedisCacheStore(async () => client);

    data.set('garbage', '{not json');
    data.set('shapeless', JSON.stringify({ v: 1 }));

    expect(await store.get('garbage')).toBeNull();
    expect(await store.get('shapeless')).toBeNull();
  });

  it('treats an unreachable Redis as a miss on read and still returns the value on write', async () => {
    const store = new RedisCacheStore(
      async () => {
        throw new Error('ECONNREFUSED');
      },
      () => NOW,
    );

    expect(await store.get('k')).toBeNull();
    expect(await store.set('k', 'v', { ttlMs: 1000 })).toEqual({
      value: 'v',
      observedAt: '2026-11-14T12:00:00.000Z',
    });
  });

  it('connects once, and tries again after a failed connection', async () => {
    const { client } = fakeRedis();
    const connect = vi
      .fn<() => Promise<RedisLike>>()
      .mockRejectedValueOnce(new Error('down'))
      .mockResolvedValue(client);
    const store = new RedisCacheStore(connect);

    await store.get('k');
    await store.get('k');
    await store.get('k');

    expect(connect).toHaveBeenCalledTimes(2);
  });
});
