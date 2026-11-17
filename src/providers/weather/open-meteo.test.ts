import { describe, expect, it } from 'vitest';
import forecastVienna from '../../../tests/fixtures/providers/open-meteo/forecast-vienna.json';
import forecastHorizonNulls from '../../../tests/fixtures/providers/open-meteo/forecast-vienna-horizon-nulls.json';
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

/** Fixed clock: the fixtures' dates are 2026-11-04.., so "today" must be the day before. */
const NOW = () => new Date('2026-11-03T09:00:00Z');

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
    const provider = new OpenMeteoWeatherProvider({ now: NOW, fetchImpl: routingFetch({}) });
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
      now: NOW,
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
        basis: 'forecast',
        temperatureMaxC: 8.8,
        temperatureMinC: 3.9,
        precipitationProbability: 0,
        windKph: 11,
        seaTemperatureC: null,
        confidence: 0.88,
      },
      {
        date: '2026-11-05',
        basis: 'forecast',
        temperatureMaxC: 10.3,
        temperatureMinC: 1.7,
        precipitationProbability: 0,
        windKph: 20,
        seaTemperatureC: null,
        confidence: 0.85,
      },
      {
        date: '2026-11-06',
        basis: 'forecast',
        temperatureMaxC: 9.6,
        temperatureMinC: 1.6,
        precipitationProbability: 0,
        windKph: 16,
        seaTemperatureC: null,
        confidence: 0.83,
      },
    ]);
  });

  it('accepts the real far-horizon response, where the vendor sends null rain probability, and omits only those days', async () => {
    const provider = new OpenMeteoWeatherProvider({
      now: () => new Date('2026-11-17T09:00:00Z'),
      fetchImpl: routingFetch({ forecast: forecastHorizonNulls }),
    });

    const result = await provider.getOutlook({
      destination: 'VIE',
      startDate: '2026-11-29',
      endDate: '2026-12-02',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // 12-01 and 12-02 carry `null` in the recording: not invented, not fatal.
    expect(result.value.map((day) => day.date)).toEqual(['2026-11-29', '2026-11-30']);
    expect(result.value[0]).toMatchObject({
      temperatureMaxC: 1.6,
      temperatureMinC: -5.5,
      precipitationProbability: 0.14,
    });
  });

  it('still rejects a forecast whose figures are the wrong type', async () => {
    const provider = new OpenMeteoWeatherProvider({
      now: NOW,
      fetchImpl: routingFetch({
        forecast: {
          daily: { ...forecastVienna.daily, temperature_2m_max: ['warm', 'warm', 'warm'] },
        },
      }),
    });
    const result = await provider.getOutlook({
      destination: 'VIE',
      startDate: '2026-11-04',
      endDate: '2026-11-06',
    });
    expect(result.ok).toBe(false);
  });

  it('reconstructs a climatology normal for a date beyond the forecast horizon from three real past Junes', async () => {
    const provider = new OpenMeteoWeatherProvider({
      // Today is deep in winter; June next year is many months out, well
      // past any forecast horizon.
      now: NOW,
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
        basis: 'climatology',
        temperatureMaxC: 26.4,
        temperatureMinC: 15.6,
        precipitationProbability: 0.32,
        windKph: 18,
        seaTemperatureC: null,
        confidence: 0.3,
      },
    ]);
  });

  it('does not count a null precipitation day as dry, and leaves that whole day out of the normal', async () => {
    // Inline, because no recorded archive response has a null precipitation
    // figure. Four June days in each sampled year. The 2025 third day has no
    // rain figure, but deliberately extreme temperature and wind: if that day
    // leaked into any average, the normal would move.
    const archive2025WithNullRain = {
      daily: {
        time: ['2025-06-01', '2025-06-02', '2025-06-03', '2025-06-04'],
        temperature_2m_max: [20, 20, 40, 20],
        temperature_2m_min: [10, 10, 30, 10],
        precipitation_sum: [0, 5, null, 0],
        wind_speed_10m_max: [10, 10, 90, 10],
      },
    };
    const archive2024 = {
      daily: {
        time: ['2024-06-01', '2024-06-02', '2024-06-03', '2024-06-04'],
        temperature_2m_max: [20, 20, 20, 20],
        temperature_2m_min: [10, 10, 10, 10],
        precipitation_sum: [0, 0, 2, 0],
        wind_speed_10m_max: [10, 10, 10, 10],
      },
    };
    const archive2023 = {
      daily: {
        time: ['2023-06-01', '2023-06-02', '2023-06-03', '2023-06-04'],
        temperature_2m_max: [20, 20, 20, 20],
        temperature_2m_min: [10, 10, 10, 10],
        precipitation_sum: [0, 0, 0, 0],
        wind_speed_10m_max: [10, 10, 10, 10],
      },
    };

    const provider = new OpenMeteoWeatherProvider({
      now: NOW,
      fetchImpl: routingFetch({ archive: [archive2025WithNullRain, archive2024, archive2023] }),
    });

    const result = await provider.getOutlook({
      destination: 'VIE',
      startDate: '2027-06-15',
      endDate: '2027-06-15',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // 11 valid June days across the three years (the null day excluded, not
    // counted dry). Rain on 2 of them: 2025-06-02 and 2024-06-03. 2 / 11 = 0.18.
    // Counting the null day as dry would give 2 / 12 = 0.17, and the averages
    // would also pick up its 40 C and 90 km/h.
    expect(result.value).toEqual([
      {
        date: '2027-06-15',
        basis: 'climatology',
        temperatureMaxC: 20,
        temperatureMinC: 10,
        precipitationProbability: 0.18,
        windKph: 10,
        seaTemperatureC: null,
        confidence: 0.3,
      },
    ]);
  });

  it('omits a date rather than inventing one when every sampled year for its month failed', async () => {
    const provider = new OpenMeteoWeatherProvider({
      now: NOW,
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
      now: NOW,
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
      now: NOW,
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
      now: NOW,
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
      now: NOW,
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
      now: NOW,
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
