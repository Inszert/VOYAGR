import type { Pool, PoolClient, QueryResultRow } from 'pg';
import { getEnv } from '@/lib/env';
import { AppError } from '@/lib/errors';
import { getLogger } from '@/lib/logger';

/**
 * PostgreSQL connection management.
 *
 * Two properties matter here, and both are about *not* needing a database:
 *
 *  1. `pg` is imported dynamically, so the driver is never loaded unless a
 *     connection is actually requested. `next build`, unit tests and the whole
 *     mock-provider development path run without touching it.
 *  2. No connection is opened at import time. Nothing connects until the first
 *     query runs.
 *
 * The repository layer (`src/db/repository.ts`) sits above this and has an
 * in-memory implementation, so the application is fully usable with
 * `DATABASE_URL` unset.
 *
 * This module is server-only by construction rather than by the `server-only`
 * package: `pg` is listed in `serverExternalPackages`, it is only ever reached
 * through a dynamic import, and no connection string is exposed to the client
 * because only `NEXT_PUBLIC_*` variables cross that boundary.
 */

const log = getLogger('db.client');

/**
 * Cached on `globalThis`, not a plain module-level `let`.
 *
 * The same class of bug `src/db/index.ts` found and fixed for the repository
 * singleton applies here with higher stakes: a plain top-level `let` is not
 * actually process-wide under Next.js's App Router, so a Route Handler
 * compiled as a separate module instance from Server Components/Actions
 * could open its *own* `pg.Pool` - not an empty in-memory store this time,
 * but a second real TCP pool of up to `DATABASE_POOL_MAX` connections to the
 * same database, on top of the first. Found while auditing this file after
 * that fix, not independently reproduced here, but the mechanism is
 * identical and the blast radius is worse: a database with a connection cap
 * (or a pooler such as PgBouncer/Supabase's pooler in front of it) would see
 * more live connections than one pool's `max` implies, which is a plausible
 * contributor to the `ECONNRESET` behaviour this project has already
 * documented (`progress.md`) without a confirmed root cause. `globalThis`
 * costs nothing once `DATABASE_URL` is set - the pool was always meant to be
 * one per process.
 */
declare global {
  var __voyagrPgPoolPromise: Promise<Pool> | undefined;
}

export function isDatabaseConfigured(): boolean {
  return Boolean(getEnv().DATABASE_URL);
}

function requireDatabaseUrl(): string {
  const url = getEnv().DATABASE_URL;

  if (!url) {
    throw new AppError(
      'DEPENDENCY_UNAVAILABLE',
      'DATABASE_URL is not set. Use the in-memory repositories, or configure Postgres.',
      {
        publicMessage: 'The database is not configured.',
        retryable: false,
      },
    );
  }

  return url;
}

/**
 * Get the shared connection pool, creating it on first use.
 *
 * @throws AppError DEPENDENCY_UNAVAILABLE when no DATABASE_URL is configured.
 */
export async function getPool(): Promise<Pool> {
  if (globalThis.__voyagrPgPoolPromise) return globalThis.__voyagrPgPoolPromise;

  const connectionString = requireDatabaseUrl();
  const env = getEnv();

  globalThis.__voyagrPgPoolPromise = (async () => {
    // Dynamic import keeps the native driver out of every bundle that never
    // queries, including the client and edge runtimes.
    const { Pool: PgPool } = await import('pg');

    const pool = new PgPool({
      connectionString,
      max: env.DATABASE_POOL_MAX,
      ssl: env.DATABASE_SSL ? { rejectUnauthorized: true } : undefined,
      // Fail fast rather than hanging a request behind an unreachable host.
      connectionTimeoutMillis: 10_000,
      // Hosted Postgres closes idle connections on its own schedule. Drop ours
      // well before that, and keep the TCP socket alive so a quiet connection
      // is not silently reset (the ECONNRESET errors seen on 2026-11-16).
      idleTimeoutMillis: 10_000,
      keepAlive: true,
      keepAliveInitialDelayMillis: 10_000,
    });

    pool.on('error', (error) => {
      // An idle client erroring must not take the process down.
      log.error({ err: error }, 'idle database client error');
    });

    log.info({ poolMax: env.DATABASE_POOL_MAX, ssl: env.DATABASE_SSL }, 'database pool created');

    return pool;
  })();

  return globalThis.__voyagrPgPoolPromise;
}

/**
 * Run a parameterised query.
 *
 * Parameters are always bound, never interpolated. String interpolation into SQL
 * is the one thing that must never appear in this codebase.
 */
export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: readonly unknown[] = [],
): Promise<T[]> {
  const pool = await getPool();
  const started = Date.now();

  try {
    const result = await pool.query<T>(text, params as unknown[]);
    log.debug({ rowCount: result.rowCount, durationMs: Date.now() - started }, 'query completed');
    return result.rows;
  } catch (error) {
    // The SQL text is logged, the parameters are not: parameters routinely hold
    // personal data.
    log.error({ err: error, sql: text, durationMs: Date.now() - started }, 'query failed');

    throw new AppError('INTERNAL_ERROR', 'Database query failed', {
      cause: error,
      context: { sql: text },
    });
  }
}

/** Run a set of statements in a transaction, rolling back on any throw. */
export async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const pool = await getPool();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackError) {
      log.error({ err: rollbackError }, 'transaction rollback failed');
    }
    throw error;
  } finally {
    client.release();
  }
}

export interface DatabaseHealth {
  readonly configured: boolean;
  readonly reachable: boolean;
  readonly latencyMs: number | null;
  readonly message?: string;
}

/** Probe the database without throwing, for the health endpoint. */
export async function checkDatabaseHealth(): Promise<DatabaseHealth> {
  if (!isDatabaseConfigured()) {
    return {
      configured: false,
      reachable: false,
      latencyMs: null,
      message: 'DATABASE_URL is not set; using in-memory repositories.',
    };
  }

  const started = Date.now();

  try {
    await query('SELECT 1');
    return { configured: true, reachable: true, latencyMs: Date.now() - started };
  } catch (error) {
    log.warn({ err: error }, 'database health check failed');
    return {
      configured: true,
      reachable: false,
      latencyMs: Date.now() - started,
      message: 'Database is configured but not reachable.',
    };
  }
}

/** Close the pool. Used by scripts and tests; not needed in request handling. */
export async function closePool(): Promise<void> {
  if (!globalThis.__voyagrPgPoolPromise) return;

  const pool = await globalThis.__voyagrPgPoolPromise;
  globalThis.__voyagrPgPoolPromise = undefined;
  await pool.end();

  log.info('database pool closed');
}
