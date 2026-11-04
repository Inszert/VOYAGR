import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetEnvCache } from '@/lib/env';
import { checkDatabaseHealth, closePool, getPool, isDatabaseConfigured, query } from './client';

/**
 * Pool lifecycle, connection failure and the persistence boundary.
 *
 * No test here opens a real connection to anything - `pg.Pool` is lazy, so
 * constructing one and ending it again touches no network at all. That is
 * also why these assertions are safe to run with no Postgres anywhere: the
 * one thing never exercised here is an actual query succeeding, which is
 * exactly the boundary `checkDatabaseHealth()` exists to report honestly.
 */

const ENV_KEYS = ['DATABASE_URL', 'DATABASE_SSL', 'DATABASE_POOL_MAX'] as const;
let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
});

afterEach(async () => {
  await closePool();
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
  resetEnvCache();
});

describe('isDatabaseConfigured', () => {
  it('is false with no DATABASE_URL', () => {
    delete process.env.DATABASE_URL;
    resetEnvCache();

    expect(isDatabaseConfigured()).toBe(false);
  });

  it('is true once DATABASE_URL is set', () => {
    process.env.DATABASE_URL = 'postgresql://user:pass@127.0.0.1:1/db';
    resetEnvCache();

    expect(isDatabaseConfigured()).toBe(true);
  });
});

describe('getPool - lifecycle', () => {
  it('refuses to build a pool with no DATABASE_URL, before any driver loads', async () => {
    delete process.env.DATABASE_URL;
    resetEnvCache();

    await expect(getPool()).rejects.toMatchObject({ code: 'DEPENDENCY_UNAVAILABLE' });
  });

  it('is one pool per process, not one per caller', async () => {
    // The property the globalThis fix exists for: two callers in the same
    // process must observe the exact same pool, never two independent
    // ones each holding their own DATABASE_POOL_MAX connections.
    process.env.DATABASE_URL = 'postgresql://user:pass@127.0.0.1:1/db';
    resetEnvCache();

    const [first, second] = await Promise.all([getPool(), getPool()]);

    expect(first).toBe(second);
  });

  it('survives closePool() and builds a fresh one on next use', async () => {
    process.env.DATABASE_URL = 'postgresql://user:pass@127.0.0.1:1/db';
    resetEnvCache();

    const before = await getPool();
    await closePool();
    const after = await getPool();

    expect(after).not.toBe(before);
  });

  it('closePool() is a no-op when nothing was ever opened', async () => {
    delete process.env.DATABASE_URL;
    resetEnvCache();

    await expect(closePool()).resolves.toBeUndefined();
  });
});

describe('query - connection failure', () => {
  it('wraps a failed query in AppError without leaking the parameters', async () => {
    // Port 1 refuses every connection instantly on any reachable host,
    // which is enough to exercise the failure path without depending on
    // network timeouts or a real database being absent/present.
    process.env.DATABASE_URL = 'postgresql://user:pass@127.0.0.1:1/db';
    resetEnvCache();

    await expect(query('SELECT 1 WHERE $1 = $1', ['not-a-real-secret'])).rejects.toMatchObject({
      code: 'INTERNAL_ERROR',
    });
  });
});

describe('checkDatabaseHealth - the persistence boundary', () => {
  it('reports unconfigured, not reachable, when DATABASE_URL is unset', async () => {
    delete process.env.DATABASE_URL;
    resetEnvCache();

    const health = await checkDatabaseHealth();

    expect(health).toMatchObject({ configured: false, reachable: false });
  });

  it('reports configured-but-unreachable rather than claiming success it cannot prove', async () => {
    process.env.DATABASE_URL = 'postgresql://user:pass@127.0.0.1:1/db';
    resetEnvCache();

    const health = await checkDatabaseHealth();

    expect(health).toMatchObject({ configured: true, reachable: false });
    expect(health.message).toBeTruthy();
  });
});
