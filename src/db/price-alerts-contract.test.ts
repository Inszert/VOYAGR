import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { resetEnvCache } from '@/lib/env';
import { closePool, query } from './client';
import { createMemoryRepositories } from './memory';
import { createPostgresRepositories } from './postgres';
import type { Repositories } from './repository';

/**
 * Contract for the price-alert log, run against every backend. Memory always; Postgres only when
 * `TEST_DATABASE_URL` answers and migration 0018 is applied. Without a database the Postgres
 * cases are skipped, not passed.
 */

const POSTGRES_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;

interface Backend {
  readonly name: string;
  readonly create: () => Repositories;
  /** Makes a watch the alert may reference; returns its id. */
  readonly watch: (repositories: Repositories) => Promise<string>;
  readonly reset: () => Promise<void>;
}

const backends: Backend[] = [
  {
    name: 'memory',
    create: () => createMemoryRepositories(),
    watch: async () => 'watch-1',
    reset: async () => undefined,
  },
];

let postgresActive = false;

if (POSTGRES_URL) {
  process.env.DATABASE_URL = POSTGRES_URL;
  resetEnvCache();
  try {
    await query('SELECT watch_id FROM price_alerts LIMIT 1');
    postgresActive = true;
  } catch {
    postgresActive = false;
  }
  if (postgresActive) {
    backends.push({
      name: 'postgres',
      create: () => createPostgresRepositories(),
      watch: async () => {
        const [user] = await query<{ id: string }>(
          `INSERT INTO users (email, plan) VALUES ('pa@example.test', 'free') RETURNING id`,
        );
        const [search] = await query<{ id: string }>(
          `INSERT INTO trip_searches (user_id, name, profile) VALUES ($1, 'x', '{}') RETURNING id`,
          [user?.id],
        );
        const [watch] = await query<{ id: string }>(
          `INSERT INTO travel_watches (user_id, trip_search_id, next_run_at)
           VALUES ($1, $2, now()) RETURNING id`,
          [user?.id, search?.id],
        );
        return watch?.id as string;
      },
      reset: async () => {
        await query('TRUNCATE price_alerts, travel_watches, trip_searches, users CASCADE');
      },
    });
  }
  afterAll(async () => {
    await closePool();
  });
}

it.skipIf(postgresActive)('postgres backend skipped: no database or migration 0018', () => {
  expect(true).toBe(true);
});

describe.each(backends)('price alerts ($name)', (backend) => {
  let repositories: Repositories;
  let watchId: string;

  beforeEach(async () => {
    await backend.reset();
    repositories = backend.create();
    watchId = await backend.watch(repositories);
  });

  const row = (over: Record<string, unknown> = {}) => ({
    watchId,
    routeKey: 'VIE-LIS-2027-03',
    observationId: 'obs-1',
    notificationId: null,
    currency: 'EUR',
    newMinor: 15000,
    medianMinor: 20000,
    createdAt: '2027-01-31T12:00:00.000Z',
    ...over,
  });

  it('records an alert and lists it newest first for its route only', async () => {
    const first = await repositories.priceAlerts.record(row());
    expect(first).toMatchObject({ observationId: 'obs-1', newMinor: 15000, medianMinor: 20000 });
    await repositories.priceAlerts.record(
      row({ observationId: 'obs-2', createdAt: '2027-02-02T12:00:00.000Z' }),
    );
    await repositories.priceAlerts.record(
      row({ observationId: 'obs-3', routeKey: 'VIE-ATH-2027-03' }),
    );

    const listed = await repositories.priceAlerts.listForRoute(watchId, 'VIE-LIS-2027-03');
    expect(listed.map((a) => a.observationId)).toEqual(['obs-2', 'obs-1']);
  });

  it('refuses a second alert for the same observation', async () => {
    expect(await repositories.priceAlerts.record(row())).not.toBeNull();
    expect(await repositories.priceAlerts.record(row({ routeKey: 'other' }))).toBeNull();
    expect(await repositories.priceAlerts.listForRoute(watchId, 'VIE-LIS-2027-03')).toHaveLength(1);
  });
});
