import { describe, expect, it, vi } from 'vitest';
import { PostgresCacheStore, type CacheQuery } from './postgres';

interface Row {
  payload: string;
  observed_at: string;
  expires_at: string;
}

/**
 * A table that answers the three statements the store issues, honouring the
 * bound parameters: a lookup is a miss once `expires_at` has passed, a write
 * replaces the row under the same key, and a delete clears expired rows.
 */
function fakeTable() {
  const rows = new Map<string, Row>();
  const statements: string[] = [];

  const query: CacheQuery = vi.fn(async (text: string, params: readonly unknown[] = []) => {
    statements.push(text);

    if (text.startsWith('INSERT')) {
      const [key = '', payload = '', observedAt = '', expiresAt = ''] = params as string[];
      rows.set(key, { payload, observed_at: observedAt, expires_at: expiresAt });
      return [];
    }

    if (text.startsWith('SELECT')) {
      const [key = '', now = ''] = params as string[];
      const row = rows.get(key);
      if (!row || !(row.expires_at > now)) return [];
      return [{ payload: JSON.parse(row.payload), observed_at: row.observed_at }];
    }

    if (text.startsWith('DELETE')) {
      const [now = ''] = params as string[];
      for (const [key, row] of rows) if (row.expires_at <= now) rows.delete(key);
      return [];
    }

    throw new Error(`unexpected statement: ${text}`);
  });

  return { query, rows, statements };
}

const START = Date.parse('2026-11-17T12:00:00.000Z');

describe('PostgresCacheStore', () => {
  it('returns a stored value with the instant it was observed', async () => {
    const { query } = fakeTable();
    let now = START;
    const store = new PostgresCacheStore(query, () => now);

    const value = { results: [{ total: { amount: 12345, currency: 'EUR' } }] };
    const written = await store.set('search:one', value, { ttlMs: 60_000 });
    now += 30_000;

    const read = await store.get<typeof value>('search:one');

    expect(read?.value).toEqual(value);
    expect(read?.observedAt).toBe(written.observedAt);
    expect(written.observedAt).toBe(new Date(START).toISOString());
  });

  it('is a miss once the entry has expired', async () => {
    const { query } = fakeTable();
    let now = START;
    const store = new PostgresCacheStore(query, () => now);

    await store.set('search:one', { a: 1 }, { ttlMs: 60_000 });
    now += 60_001;

    expect(await store.get('search:one')).toBeNull();
  });

  it('is a miss for a key that was never written', async () => {
    const { query } = fakeTable();
    const store = new PostgresCacheStore(query, () => START);

    expect(await store.get('search:none')).toBeNull();
  });

  it('replaces the value under a key that is written again', async () => {
    const { query } = fakeTable();
    let now = START;
    const store = new PostgresCacheStore(query, () => now);

    await store.set('search:one', { version: 1 }, { ttlMs: 60_000 });
    now += 10_000;
    const second = await store.set('search:one', { version: 2 }, { ttlMs: 60_000 });

    const read = await store.get<{ version: number }>('search:one');
    expect(read?.value).toEqual({ version: 2 });
    expect(read?.observedAt).toBe(second.observedAt);
  });

  it('removes expired rows on write, so the table does not grow without bound', async () => {
    const { query, rows } = fakeTable();
    let now = START;
    const store = new PostgresCacheStore(query, () => now);

    await store.set('search:old', { a: 1 }, { ttlMs: 1_000 });
    now += 5_000;
    await store.set('search:new', { b: 2 }, { ttlMs: 60_000 });

    expect([...rows.keys()]).toEqual(['search:new']);
  });

  it('binds the key as a parameter and never puts it into the SQL text', async () => {
    const { query, statements } = fakeTable();
    const store = new PostgresCacheStore(query, () => START);
    const hostile = "x'; DROP TABLE cache_entries; --";

    await store.set(hostile, { a: 1 }, { ttlMs: 60_000 });
    await store.get(hostile);

    for (const text of statements) expect(text).not.toContain('DROP');
    expect(statements.every((text) => !text.includes(hostile))).toBe(true);
  });

  it('treats a broken database as a miss on read, and still returns the value on write', async () => {
    const broken: CacheQuery = vi.fn(async () => {
      throw new Error('connection reset');
    });
    const store = new PostgresCacheStore(broken, () => START);

    expect(await store.get('search:one')).toBeNull();

    const written = await store.set('search:one', { a: 1 }, { ttlMs: 60_000 });
    expect(written.value).toEqual({ a: 1 });
    expect(written.observedAt).toBe(new Date(START).toISOString());
  });
});
