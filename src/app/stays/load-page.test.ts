import { afterEach, describe, expect, it, vi } from 'vitest';
import { getRepositories, resetRepositories } from '@/db';
import { resetEnvCache } from '@/lib/env';
import { STORED_SCHEMA_VERSION, toStoredRates } from '@/liteapi-snapshot/stored-schema';
import { ratesKey } from '@/liteapi-snapshot/targets';
import { aProperty, aRate } from '@/liteapi-snapshot/test-support';
import { resetStayProviders } from '@/providers/stays/registry';
import { loadStaySearch } from '@/search/stays/load-stays';
import { loadStaysPage } from './load-page';

const TODAY = '2027-01-10';
const PARAMS = { destination: 'Lisbon', destinationCode: 'LIS', dates: 'confirmed' };
const WINDOW = { checkIn: '2027-02-09', checkOut: '2027-02-13' } as const;

function reset() {
  resetEnvCache();
  resetStayProviders();
  resetRepositories();
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  reset();
});

describe('loadStaysPage', () => {
  it('makes no network call on the mock path and returns the page shape', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const view = await loadStaySearch(PARAMS, TODAY, 'mock');
    const data = await loadStaysPage(view, PARAMS, 'mock');

    expect(Object.keys(data).sort()).toEqual(
      ['area', 'cheapestId', 'listings', 'locator', 'partnerLinks', 'place', 'rows'].sort(),
    );
    expect(data.place?.city).toBeTruthy();
    expect(data.area).not.toBeNull();
    expect(data.partnerLinks).toBeInstanceOf(Map);
    expect(Array.isArray(data.rows)).toBe(true);
    expect(data.locator).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('is empty on the dates step', async () => {
    const view = await loadStaySearch(
      { destination: 'Lisbon', destinationCode: 'LIS' },
      TODAY,
      'mock',
    );
    const data = await loadStaysPage(view, {}, 'mock');

    expect(data).toMatchObject({
      place: null,
      listings: null,
      rows: [],
      area: null,
      locator: null,
    });
    expect(data.partnerLinks.size).toBe(0);
  });

  it('makes no network call on the liteapi snapshot path', async () => {
    vi.stubEnv('STAY_PROVIDERS', 'liteapi');
    vi.stubEnv('LITEAPI_API_KEY', 'sand_key_for_tests');
    vi.stubEnv('LITEAPI_SNAPSHOT_REFRESHES_PER_DAY', '3');
    reset();
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
      observedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
      runId: 'seed',
    });
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    const view = await loadStaySearch(PARAMS, TODAY, 'api');
    const data = await loadStaysPage(view, PARAMS, 'api');

    expect(data.place).not.toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('has no locator for a property step whose property has no position', async () => {
    const results = await loadStaySearch(PARAMS, TODAY, 'mock');
    const stay = results.stays[0];
    expect(stay).toBeDefined();
    const view = {
      ...results,
      step: 'property' as const,
      openStay: { ...stay!, property: { ...stay!.property, position: null } },
    };

    const data = await loadStaysPage(view, PARAMS, 'mock');

    expect(data.locator).toBeNull();
  });
});
