import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetCacheStore } from '@/cache';
import { AppError } from '@/lib/errors';
import { err, ok } from '@/lib/result';
import type { WeatherOutlook } from '@/core/trip/types';
import {
  getProviderRegistry,
  resetProviderRegistry,
  type ProviderRegistry,
} from '@/providers/registry';
import type { WeatherProvider } from '@/providers/types';
import { groupPlaces, loadDestinationDetail, PLACE_SECTIONS } from './destination-detail';

/**
 * The destination page's data.
 *
 * What is defended: a place we do not know is a 404 rather than an empty shell
 * with a name in it, a provider that fails degrades the page instead of
 * emptying it, and mock data is labelled as mock wherever it lands.
 */

beforeEach(() => {
  resetCacheStore();
});

afterEach(() => {
  resetProviderRegistry();
  resetCacheStore();
});

const query = { destination: 'AYT', currency: 'EUR', passengers: 2 } as const;

describe('loadDestinationDetail', () => {
  it('gathers what the adapters actually return', async () => {
    const detail = await loadDestinationDetail(query);

    expect(detail?.place.name).toBe('Antalya');
    expect(detail?.places.length).toBeGreaterThan(0);
    expect(detail?.transfers.length).toBeGreaterThan(0);
  });

  it('refuses a code that is not a destination', async () => {
    // A 404, not a page with an airport code as a heading and nothing under it.
    expect(await loadDestinationDetail({ ...query, destination: 'QQQ' })).toBeNull();
  });

  it('says the data is mock when the adapters are', async () => {
    expect((await loadDestinationDetail(query))?.provenance).toBe('mock');
  });

  it('has no outlook when no dates were given', async () => {
    // Arriving without a search must not invent a window to forecast.
    expect((await loadDestinationDetail(query))?.weather).toEqual([]);
  });

  it('fetches the outlook for the dates it was given', async () => {
    const detail = await loadDestinationDetail({
      ...query,
      startDate: '2026-06-10',
      endDate: '2026-06-14',
    });

    expect(detail?.weather).toHaveLength(5);
    expect(detail?.weather[0]?.date).toBe('2026-06-10');
  });

  it('is deterministic', async () => {
    // The page is cacheable, and a page that changes between two identical
    // requests is a page nobody can test.
    expect(await loadDestinationDetail(query)).toEqual(await loadDestinationDetail(query));
  });

  it('reports nothing unavailable when everything answered', async () => {
    expect((await loadDestinationDetail(query))?.unavailable).toEqual([]);
  });
});

describe('the outlook, through the cache', () => {
  const day = (date: string, basis: WeatherOutlook['basis']): WeatherOutlook => ({
    date: date as WeatherOutlook['date'],
    basis,
    temperatureMinC: 10,
    temperatureMaxC: 20,
    precipitationProbability: 0.2,
    windKph: 10,
    seaTemperatureC: null,
    confidence: basis === 'forecast' ? 0.8 : 0.3,
  });

  /** The mock registry with only the weather swapped for one the test controls. */
  function withWeather(getOutlook: WeatherProvider['getOutlook']) {
    const real = getProviderRegistry();
    const weather: WeatherProvider = {
      ...real.weather,
      metadata: real.weather.metadata,
      getOutlook,
    };
    globalThis.__voyagrProviderRegistries = new Map([
      ['api', { ...real, weather } as unknown as ProviderRegistry],
    ]);
  }

  const dated = {
    ...query,
    startDate: '2027-06-15',
    endDate: '2027-06-16',
    now: () => new Date('2026-11-14T09:00:00Z'),
  } as const;

  it('asks the provider once for the same destination and dates', async () => {
    const getOutlook = vi.fn(async () =>
      ok([day('2027-06-15', 'climatology'), day('2027-06-16', 'climatology')]),
    );
    withWeather(getOutlook);

    await loadDestinationDetail(dated);
    const second = await loadDestinationDetail(dated);

    expect(getOutlook).toHaveBeenCalledTimes(1);
    expect(second?.weather).toHaveLength(2);
  });

  it('keeps what the day says it is: a forecast stays a forecast, an average stays an average', async () => {
    withWeather(async () => ok([day('2027-06-15', 'forecast'), day('2027-06-16', 'climatology')]));

    const detail = await loadDestinationDetail(dated);

    expect(detail?.weather.map((entry) => entry.basis)).toEqual(['forecast', 'climatology']);
  });

  it('does not cache a failure as an answer, and says the weather did not answer', async () => {
    const getOutlook = vi
      .fn<WeatherProvider['getOutlook']>()
      .mockResolvedValueOnce(err(new AppError('PROVIDER_UNAVAILABLE', 'down')))
      .mockResolvedValue(ok([day('2027-06-15', 'climatology')]));
    withWeather(getOutlook);

    const failed = await loadDestinationDetail(dated);
    expect(failed?.weather).toEqual([]);
    expect(failed?.unavailable).toContain('weather');

    const retried = await loadDestinationDetail(dated);
    expect(getOutlook).toHaveBeenCalledTimes(2);
    expect(retried?.weather).toHaveLength(1);
  });
});

describe('groupPlaces', () => {
  it('drops a section with nothing in it', async () => {
    // An empty "Beaches" heading on a landlocked city is a promise the page
    // cannot keep.
    const inland = await loadDestinationDetail({ ...query, destination: 'TBS' });
    const headings = groupPlaces(inland?.places ?? []).map((section) => section.category);

    expect(headings).not.toContain('beach');
    expect(headings.length).toBeGreaterThan(0);
  });

  it('keeps the declared order', async () => {
    const detail = await loadDestinationDetail(query);
    const order = groupPlaces(detail?.places ?? []).map((section) => section.category);
    const declared = PLACE_SECTIONS.map((section) => section.category).filter((category) =>
      order.includes(category),
    );

    expect(order).toEqual(declared);
  });

  it('puts every place in exactly one section', async () => {
    const detail = await loadDestinationDetail(query);
    const grouped = groupPlaces(detail?.places ?? []);
    const total = grouped.reduce((sum, section) => sum + section.places.length, 0);

    expect(total).toBe(detail?.places.length);
  });
});
