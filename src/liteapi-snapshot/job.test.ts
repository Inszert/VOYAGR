import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMemoryRepositories } from '@/db/memory';
import { createLimiter } from '@/lib/concurrency';
import { AppError } from '@/lib/errors';
import { err, ok } from '@/lib/result';
import type { Job } from '@/queue/types';
import { createSnapshotRefreshHandler, type SnapshotClient } from './job';
import { STORED_SCHEMA_VERSION, readStoredRates } from './stored-schema';
import { LAUNCH_DESTINATIONS, snapshotTargets, targetKey } from './targets';
import { aProperty, aRate } from './test-support';

const logged: unknown[] = [];
vi.mock('@/lib/logger', () => ({
  getLogger: () => ({
    info: (...args: unknown[]) => logged.push(args),
    warn: (...args: unknown[]) => logged.push(args),
    error: (...args: unknown[]) => logged.push(args),
    debug: (...args: unknown[]) => logged.push(args),
  }),
}));

const KEY = 'sand_super_secret_key_123';
const NOW = Date.parse('2027-01-10T12:00:00.000Z');
const ENV = {
  LITEAPI_API_KEY: KEY,
  LITEAPI_GUEST_NATIONALITY: 'US',
  LITEAPI_SNAPSHOT_ENABLED: true,
  LITEAPI_SNAPSHOT_REFRESHES_PER_DAY: 3,
};
const ONE = [LAUNCH_DESTINATIONS[0]!];
const TARGET = snapshotTargets('2027-01-10', 'US', ONE)[0]!;
const PAYLOAD = {
  destination: TARGET.destination.code,
  checkIn: TARGET.checkIn,
  checkOut: TARGET.checkOut,
};

function aJob(payload = PAYLOAD): Job<'liteapi.snapshot.refresh'> {
  return {
    id: 'j1',
    name: 'liteapi.snapshot.refresh',
    payload,
    attempt: 1,
    enqueuedAt: new Date(NOW).toISOString(),
  };
}

function fakeClient(overrides: Partial<SnapshotClient> = {}) {
  const client = {
    listHotels: vi.fn(async () => ok([aProperty])),
    fetchRates: vi.fn(async () => ok(new Map([[aProperty.providerPropertyId, [aRate]]]))),
    ...overrides,
  } satisfies SnapshotClient;
  return client;
}

function setup(options: { env?: Partial<typeof ENV>; client?: SnapshotClient; max?: number } = {}) {
  const repositories = createMemoryRepositories({ now: () => NOW });
  const client = options.client ?? fakeClient();
  const createClient = vi.fn(() => client);
  const handler = createSnapshotRefreshHandler({
    repositories,
    env: { ...ENV, ...options.env },
    now: () => NOW,
    createClient,
    limiter: createLimiter(1),
    runId: (() => {
      let n = 0;
      return () => `run-${++n}`;
    })(),
    destinations: ONE,
    ...(options.max ? { maxCallsPerRun: options.max } : {}),
  });
  return { repositories, repo: repositories.liteapiSnapshot, client, createClient, handler };
}

afterEach(() => {
  vi.restoreAllMocks();
  logged.length = 0;
});

describe('the refresh job', () => {
  it('writes a validated row, and records the run with two calls on a cold start', async () => {
    const { repo, handler, client } = setup();

    await handler(aJob());

    expect(client.listHotels).toHaveBeenCalledTimes(1);
    expect(client.fetchRates).toHaveBeenCalledTimes(1);
    const row = await repo.getRates(targetKey(TARGET));
    expect(row).toMatchObject({
      environment: 'sandbox',
      schemaVersion: STORED_SCHEMA_VERSION,
      observedAt: aRate.observedAt,
      runId: 'run-1',
    });
    // 3 x the 8 hour interval after the observation.
    expect(row?.expiresAt).toBe('2027-01-11T08:00:00.000Z');
    const read = readStoredRates(row!.schemaVersion, row!.rates);
    expect(read.ok && read.offers[0]!.rates[0]!.total).toEqual({ amount: 33333, currency: 'EUR' });
    expect(await repo.latestRun()).toMatchObject({ status: 'ok', callsMade: 2, errorCode: null });
  });

  it('reuses stored hotel content, so the next run makes one call', async () => {
    const { repo, handler, client } = setup();

    await handler(aJob());
    await handler(aJob());

    expect(client.listHotels).toHaveBeenCalledTimes(1);
    expect(client.fetchRates).toHaveBeenCalledTimes(2);
    expect((await repo.latestRun())?.callsMade).toBe(1);
    expect(await repo.getHotels('LIS')).toHaveLength(1);
  });

  it('keeps the old row when the provider fails, records only the code, and does not throw', async () => {
    const client = fakeClient();
    const { repo, handler } = setup({ client });
    await handler(aJob());
    const before = await repo.getRates(targetKey(TARGET));
    vi.mocked(client.fetchRates).mockResolvedValueOnce(
      err(new AppError('PROVIDER_TIMEOUT', `LiteAPI said no to ${KEY}`)) as never,
    );

    await expect(handler(aJob())).resolves.toBeUndefined();

    expect(await repo.getRates(targetKey(TARGET))).toEqual(before);
    expect(await repo.latestRun()).toMatchObject({
      status: 'failed',
      errorCode: 'PROVIDER_TIMEOUT',
      callsMade: 1,
    });
    expect(JSON.stringify(logged)).not.toContain(KEY);
    expect(JSON.stringify(logged)).toContain('PROVIDER_TIMEOUT');
  });

  it('writes nothing when the hotel list call fails', async () => {
    const { repo, handler } = setup({
      client: fakeClient({
        listHotels: vi.fn(async () => err(new AppError('PROVIDER_ERROR', 'x'))) as never,
      }),
    });

    await handler(aJob());

    expect(await repo.getRates(targetKey(TARGET))).toBeNull();
    expect(await repo.latestRun()).toMatchObject({ status: 'failed', errorCode: 'PROVIDER_ERROR' });
  });

  it('stops at the per-run cap: the second call is not made and the run is skipped_cap', async () => {
    const { repo, handler, client } = setup({ max: 1 });

    await handler(aJob());

    expect(client.listHotels).toHaveBeenCalledTimes(1);
    expect(client.fetchRates).not.toHaveBeenCalled();
    expect(await repo.latestRun()).toMatchObject({ status: 'skipped_cap', callsMade: 1 });
    expect(await repo.getRates(targetKey(TARGET))).toBeNull();
  });

  it('refuses a run once the daily ceiling is used, with no call at all', async () => {
    const { repo, handler, client } = setup();
    // One destination x 3 windows x 3 refreshes + 1 content call = 10.
    await repo.startRun({
      runId: 'earlier',
      job: 'liteapi.snapshot.refresh',
      destinationCode: 'LIS',
      checkIn: TARGET.checkIn,
      checkOut: TARGET.checkOut,
      environment: 'sandbox',
    });
    await repo.finishRun('earlier', { status: 'ok', callsMade: 10 });

    await handler(aJob());

    expect(client.listHotels).not.toHaveBeenCalled();
    expect(client.fetchRates).not.toHaveBeenCalled();
    expect(await repo.latestRun()).toMatchObject({ status: 'skipped_cap', callsMade: 0 });
  });

  it('ignores yesterday when counting toward the ceiling', async () => {
    const { repo, client } = setup();
    await repo.startRun({
      runId: 'old',
      job: 'liteapi.snapshot.refresh',
      destinationCode: 'LIS',
      checkIn: TARGET.checkIn,
      checkOut: TARGET.checkOut,
      environment: 'sandbox',
    });
    await repo.finishRun('old', { status: 'ok', callsMade: 10 });
    // `old` started at NOW; ask from a day later so it counts as yesterday.
    const later = createSnapshotRefreshHandler({
      repositories: { liteapiSnapshot: repo },
      env: ENV,
      now: () => NOW + 24 * 3_600_000,
      createClient: () => client,
      destinations: ONE,
      limiter: createLimiter(1),
    });

    await later(
      aJob({
        ...PAYLOAD,
        checkIn: '2027-02-10',
        checkOut: '2027-02-14',
      }),
    );

    expect(client.fetchRates).toHaveBeenCalled();
  });

  it('refuses a window or destination it was not given, without a call', async () => {
    const { repo, handler, client } = setup();

    await handler(aJob({ ...PAYLOAD, destination: 'XXX' }));
    await handler(aJob({ ...PAYLOAD, checkIn: '2027-06-01', checkOut: '2027-06-05' }));

    expect(client.listHotels).not.toHaveBeenCalled();
    expect(await repo.latestRun()).toMatchObject({
      status: 'failed',
      errorCode: 'VALIDATION_ERROR',
    });
  });

  it('never holds more calls in flight than the limiter allows', async () => {
    let inFlight = 0;
    let peak = 0;
    const slow = async <T>(value: T) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight -= 1;
      return ok(value);
    };
    const client = fakeClient({
      listHotels: vi.fn(() => slow([aProperty] as const)) as never,
      fetchRates: vi.fn(() => slow(new Map([[aProperty.providerPropertyId, [aRate]]]))) as never,
    });
    const limiter = createLimiter(1);
    const repositories = createMemoryRepositories({ now: () => NOW });
    const handler = createSnapshotRefreshHandler({
      repositories,
      env: ENV,
      now: () => NOW,
      createClient: () => client,
      limiter,
      destinations: ONE,
    });
    const windows = snapshotTargets('2027-01-10', 'US', ONE);

    await Promise.all(
      windows.map((target) =>
        handler(aJob({ destination: 'LIS', checkIn: target.checkIn, checkOut: target.checkOut })),
      ),
    );

    expect(peak).toBe(1);
    expect(limiter.peakInFlight).toBe(1);
  });
});

describe('the flag', () => {
  it('records "disabled", builds no client and makes zero fetches when the flag is off', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const { repositories, handler, createClient } = setup({
      env: { LITEAPI_SNAPSHOT_ENABLED: false },
    });
    // Built for real: with the flag off the default client must never be reached either.
    const real = createSnapshotRefreshHandler({
      repositories,
      env: { ...ENV, LITEAPI_SNAPSHOT_ENABLED: false },
      now: () => NOW,
      destinations: ONE,
    });

    await handler(aJob());
    await real(aJob());

    expect(createClient).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(await repositories.liteapiSnapshot.getRates(targetKey(TARGET))).toBeNull();
    // `disabled` is recorded but is not an attempt.
    expect(await repositories.liteapiSnapshot.latestRun()).toBeNull();
    expect(await repositories.liteapiSnapshot.callsSince('1970-01-01T00:00:00.000Z')).toBe(0);
  });

  it('behaves the same with no key, even when the flag is on', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const { handler, createClient } = setup({ env: { LITEAPI_API_KEY: undefined as never } });

    await handler(aJob());

    expect(createClient).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
