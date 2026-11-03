import { describe, expect, it } from 'vitest';
import forecastVienna from '../../../tests/fixtures/providers/open-meteo/forecast-vienna.json';
import archive2023 from '../../../tests/fixtures/providers/open-meteo/archive-2023-06.json';
import archive2024 from '../../../tests/fixtures/providers/open-meteo/archive-2024-06.json';
import archive2025 from '../../../tests/fixtures/providers/open-meteo/archive-2025-06.json';
import { OpenMeteoWeatherProvider } from './open-meteo';

/**
 * The Open-Meteo adapter, offline.
 *
 * `forecast-vienna.json` and the three `archive-20XX-06.json` fixtures are
 * genuine response bodies recorded against the real API (see the fixtures'
 * own README) - this is where the field names, the numeric (never-null)
 * forecast precipitation figure, and the nullable archive fields are
 * evidenced. The climatology averages asserted below were computed from
 * those same three files, not invented.
 */

const respond = (body: unknown, status = 200) =>
  Promise.resolve(
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }),
  );

/** Routes by host, the way the adapter itself picks an endpoint. */
function routingFetch(responses: { forecast?: unknown; archive?: unknown[] }) {
  let archiveCallIndex = 0;

  return (url: string) => {
    if (url.startsWith('https://archive-api.open-meteo.com')) {
      const body = responses.archive?.[archiveCallIndex];
      archiveCallIndex += 1;
      return respond(body ?? { error: true, reason: 'no fixture for this call' }, body ? 200 : 500);
    }

    return respond(responses.forecast ?? { error: true, reason: 'no fixture for this call' });
  };
}

describe('OpenMeteoWeatherProvider', () => {
  it('declares itself real, keyless, and rate-limited', () => {
    const provider = new OpenMeteoWeatherProvider();
    expect(provider.metadata.isMock).toBe(false);
    expect(provider.metadata.rateLimitPerMinute).toBeGreaterThan(0);
  });

  it('refuses a destination with no airport reference data, rather than guessing coordinates', async () => {
    const provider = new OpenMeteoWeatherProvider({ fetchImpl: routingFetch({}) });
    const result = await provider.getOutlook({
      destination: 'ZZZ',
      startDate: '2026-11-04',
      endDate: '2026-11-06',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('VALIDATION_ERROR');
  });

  it('maps a real forecast response, converting percent to a fraction and decaying confidence by lead time', async () => {
    const provider = new OpenMeteoWeatherProvider({
      now: () => new Date('2026-11-03T09:00:00Z'),
      fetchImpl: routingFetch({ forecast: forecastVienna }),
    });

    const result = await provider.getOutlook({
      destination: 'VIE',
      startDate: '2026-11-04',
      endDate: '2026-11-06',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value).toEqual([
      {
        date: '2026-11-04',
        temperatureMaxC: 8.8,
        temperatureMinC: 3.9,
        precipitationProbability: 0,
        windKph: 11,
        seaTemperatureC: null,
        confidence: 0.88,
      },
      {
        date: '2026-11-05',
        temperatureMaxC: 10.3,
        temperatureMinC: 1.7,
        precipitationProbability: 0,
        windKph: 20,
        seaTemperatureC: null,
        confidence: 0.85,
      },
      {
        date: '2026-11-06',
        temperatureMaxC: 9.6,
        temperatureMinC: 1.6,
        precipitationProbability: 0,
        windKph: 16,
        seaTemperatureC: null,
        confidence: 0.83,
      },
    ]);
  });

  it('reconstructs a climatology normal for a date beyond the forecast horizon from three real past Junes', async () => {
    const provider = new OpenMeteoWeatherProvider({
      // Today is deep in winter; June next year is many months out, well
      // past any forecast horizon.
      now: () => new Date('2026-11-03T09:00:00Z'),
      fetchImpl: routingFetch({ archive: [archive2025, archive2024, archive2023] }),
    });

    const result = await provider.getOutlook({
      destination: 'VIE',
      startDate: '2027-06-15',
      endDate: '2027-06-15',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Figures computed directly from the three fixture files: averaged
    // across all 90 recorded June days (30 days x 3 years), not asserted
    // against a number this test made up.
    expect(result.value).toEqual([
      {
        date: '2027-06-15',
        temperatureMaxC: 26.4,
        temperatureMinC: 15.6,
        precipitationProbability: 0.32,
        windKph: 18,
        seaTemperatureC: null,
        confidence: 0.3,
      },
    ]);
  });

  it('omits a date rather than inventing one when every sampled year for its month failed', async () => {
    const provider = new OpenMeteoWeatherProvider({
      now: () => new Date('2026-11-03T09:00:00Z'),
      fetchImpl: routingFetch({ archive: [] }),
    });

    const result = await provider.getOutlook({
      destination: 'VIE',
      startDate: '2027-06-15',
      endDate: '2027-06-15',
    });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual([]);
  });

  it('treats a 429 as PROVIDER_UNAVAILABLE and any other error status as PROVIDER_ERROR', async () => {
    const tooMany = new OpenMeteoWeatherProvider({
      fetchImpl: () => respond({ error: true, reason: 'rate limited' }, 429),
    });
    const tooManyResult = await tooMany.getOutlook({
      destination: 'VIE',
      startDate: '2026-11-04',
      endDate: '2026-11-04',
    });
    expect(tooManyResult.ok).toBe(false);
    if (!tooManyResult.ok) expect(tooManyResult.error.code).toBe('PROVIDER_UNAVAILABLE');

    const broken = new OpenMeteoWeatherProvider({
      fetchImpl: () => respond({ error: true, reason: 'bad request' }, 400),
    });
    const brokenResult = await broken.getOutlook({
      destination: 'VIE',
      startDate: '2026-11-04',
      endDate: '2026-11-04',
    });
    expect(brokenResult.ok).toBe(false);
    if (!brokenResult.ok) expect(brokenResult.error.code).toBe('PROVIDER_ERROR');
  });

  it('reports a timeout distinctly from an unreachable host', async () => {
    const timedOut = new OpenMeteoWeatherProvider({
      fetchImpl: () => {
        const error = new Error('aborted');
        error.name = 'AbortError';
        return Promise.reject(error);
      },
    });
    const timedOutResult = await timedOut.getOutlook({
      destination: 'VIE',
      startDate: '2026-11-04',
      endDate: '2026-11-04',
    });
    expect(timedOutResult.ok).toBe(false);
    if (!timedOutResult.ok) expect(timedOutResult.error.code).toBe('PROVIDER_TIMEOUT');

    const unreachable = new OpenMeteoWeatherProvider({
      fetchImpl: () => Promise.reject(new Error('network down')),
    });
    const unreachableResult = await unreachable.getOutlook({
      destination: 'VIE',
      startDate: '2026-11-04',
      endDate: '2026-11-04',
    });
    expect(unreachableResult.ok).toBe(false);
    if (!unreachableResult.ok) expect(unreachableResult.error.code).toBe('PROVIDER_UNAVAILABLE');
  });

  it('rejects an unrecognised response shape rather than mapping it anyway', async () => {
    const provider = new OpenMeteoWeatherProvider({
      fetchImpl: () => respond({ not: 'the expected shape' }),
    });
    const result = await provider.getOutlook({
      destination: 'VIE',
      startDate: '2026-11-04',
      endDate: '2026-11-04',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('PROVIDER_ERROR');
  });
});
