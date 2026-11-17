import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getRepositories, resetRepositories } from '@/db';
import { resetEnvCache } from '@/lib/env';
import { STORED_SCHEMA_VERSION, toStoredRates } from '@/liteapi-snapshot/stored-schema';
import { ratesKey } from '@/liteapi-snapshot/targets';
import { aProperty, aRate } from '@/liteapi-snapshot/test-support';
import { resetStayProviders } from '@/providers/stays/registry';
import { loadStaySearch } from './load-stays';

const TODAY = '2027-01-10';
const HOUR = 3_600_000;
const PARAMS = { destination: 'Lisbon', destinationCode: 'LIS', dates: 'confirmed' };
// Today plus 30, four nights: the first launch window.
const WINDOW = { checkIn: '2027-02-09', checkOut: '2027-02-13' } as const;

function useLiteApi() {
  vi.stubEnv('STAY_PROVIDERS', 'liteapi');
  vi.stubEnv('LITEAPI_API_KEY', 'sand_key_for_tests');
  vi.stubEnv('LITEAPI_SNAPSHOT_REFRESHES_PER_DAY', '3');
  resetEnvCache();
  resetStayProviders();
  resetRepositories();
}

async function seedRow(ageHours: number) {
  const observed = Date.now() - ageHours * HOUR;
  await getRepositories().liteapiSnapshot.putRates({
    ...ratesKey({
      destinationCode: 'LIS',
      ...WINDOW,
      occupancy: { adults: 2, children: 0, rooms: 1 },
      currency: 'EUR',
      guestNationality: 'US',
    }),
    environment: 'sandbox',
    schemaVersion: STORED_SCHEMA_VERSION,
    rates: toStoredRates([{ property: aProperty, rates: [aRate] }]),
    observedAt: new Date(observed).toISOString(),
    expiresAt: new Date(observed + 24 * HOUR).toISOString(),
    runId: 'seed',
  });
}

describe('a visitor search with LiteAPI configured', () => {
  beforeEach(useLiteApi);

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    resetEnvCache();
    resetStayProviders();
    resetRepositories();
  });

  it('makes zero fetches on the results step, with or without a stored row', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    await loadStaySearch(PARAMS, TODAY);
    await seedRow(5);
    await loadStaySearch(PARAMS, TODAY);

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('makes zero fetches on the dates step, the calendar and the property step too', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    await seedRow(5);

    await loadStaySearch({ destination: 'Lisbon', destinationCode: 'LIS' }, TODAY);
    await loadStaySearch({ ...PARAMS, property: 'anything' }, TODAY);

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('serves the stored hotel with its price, and says how old and that it is test data', async () => {
    await seedRow(5);

    const view = await loadStaySearch(PARAMS, TODAY);

    expect(view.stays.map((stay) => stay.property.name)).toEqual(['Hotel Alfama']);
    expect(view.snapshot).toMatchObject({ state: 'fresh', ageHours: 5, testPrices: true });
  });

  it('shows the dates-step calendar price from the stored window, and nothing for the others', async () => {
    await seedRow(5);

    const view = await loadStaySearch({ destination: 'Lisbon', destinationCode: 'LIS' }, TODAY);

    const priced = view.calendar.filter((entry) => entry.total !== null);
    expect(priced.map((entry) => entry.checkIn)).toEqual([WINDOW.checkIn]);
    expect(priced[0]!.total).toEqual({ amount: 33333, currency: 'EUR' });
  });

  it('says a window nobody refreshed is not loaded: no stay, no price, state missing', async () => {
    await seedRow(5);

    const view = await loadStaySearch(
      { ...PARAMS, checkIn: '2027-03-01', checkOut: '2027-03-05' },
      TODAY,
    );

    expect(view.stays).toEqual([]);
    expect(view.snapshot).toMatchObject({ state: 'missing', ageHours: null });
  });

  it('is missing for a party the snapshot does not price', async () => {
    await seedRow(5);

    const view = await loadStaySearch({ ...PARAMS, children: '1' }, TODAY);

    expect(view.stays).toEqual([]);
    expect(view.snapshot?.state).toBe('missing');
  });

  it('calls a row older than 16 hours aging', async () => {
    await seedRow(20);

    const view = await loadStaySearch(PARAMS, TODAY);

    expect(view.snapshot).toMatchObject({ state: 'aging', ageHours: 20 });
  });

  it('reads a row that is not valid as missing, instead of showing it', async () => {
    await seedRow(5);
    const key = ratesKey({
      destinationCode: 'LIS',
      ...WINDOW,
      occupancy: { adults: 2, children: 0, rooms: 1 },
      currency: 'EUR',
      guestNationality: 'US',
    });
    const row = (await getRepositories().liteapiSnapshot.getRates(key))!;
    await getRepositories().liteapiSnapshot.putRates({
      ...row,
      schemaVersion: STORED_SCHEMA_VERSION - 1,
    });

    const view = await loadStaySearch(PARAMS, TODAY);

    expect(view.stays).toEqual([]);
    expect(view.snapshot?.state).toBe('missing');
  });
});

describe('a search without LiteAPI', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    resetEnvCache();
    resetStayProviders();
  });

  it('has no snapshot status', async () => {
    vi.stubEnv('STAY_PROVIDERS', 'mock');
    resetEnvCache();
    resetStayProviders();

    const view = await loadStaySearch(PARAMS, TODAY);

    expect(view.snapshot).toBeNull();
  });
});
