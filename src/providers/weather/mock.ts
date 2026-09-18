import type { WeatherOutlook } from '@/core/trip/types';
import { ok } from '@/lib/result';
import { addDays, deterministicSource, MOCK_OBSERVED_AT } from '../fixtures/deterministic';
import { resolveDestination } from '../fixtures/destinations';
import type {
  ProviderHealth,
  ProviderRequestOptions,
  ProviderResult,
  WeatherProvider,
  WeatherQuery,
} from '../types';

/**
 * Mock weather provider.
 *
 * Builds an outlook from the destination's monthly climate normals, with
 * deterministic day-to-day variation.
 *
 * Confidence decays with lead time, which is the point: the specification
 * (sections 13 and 31.11) insists a long-range outlook is climatology, not a
 * forecast, and the scoring engine must treat it as such.
 */

/** Days ahead beyond which an outlook is climatology rather than a forecast. */
const FORECAST_HORIZON_DAYS = 14;
/** Confidence floor for pure climatology. */
const CLIMATOLOGY_CONFIDENCE = 0.35;

/** Reference "today" for the mock, so confidence is stable across runs. */
const MOCK_TODAY = MOCK_OBSERVED_AT.slice(0, 10);

function daysBetween(from: string, to: string): number {
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  return Math.round((end - start) / 86_400_000);
}

function confidenceForLeadTime(leadDays: number): number {
  if (leadDays <= 0) return 0.95;
  if (leadDays >= FORECAST_HORIZON_DAYS) return CLIMATOLOGY_CONFIDENCE;

  // Linear decay from 0.95 at day 0 to the climatology floor at the horizon.
  const decayed = 0.95 - (leadDays / FORECAST_HORIZON_DAYS) * (0.95 - CLIMATOLOGY_CONFIDENCE);
  return Math.round(decayed * 100) / 100;
}

export class MockWeatherProvider implements WeatherProvider {
  readonly metadata = {
    id: 'mock-weather',
    kind: 'weather',
    displayName: 'Mock Weather Provider',
    isMock: true,
    rateLimitPerMinute: null,
  } as const;

  async checkHealth(_options?: ProviderRequestOptions): Promise<ProviderHealth> {
    return {
      status: 'healthy',
      checkedAt: MOCK_OBSERVED_AT,
      latencyMs: 0,
      message: 'Mock provider; no network call performed.',
    };
  }

  async getOutlook(
    query: WeatherQuery,
    _options?: ProviderRequestOptions,
  ): Promise<ProviderResult<readonly WeatherOutlook[]>> {
    const profile = resolveDestination(query.destination);
    const span = daysBetween(query.startDate, query.endDate);

    if (span < 0) return ok([]);

    const outlook: WeatherOutlook[] = [];

    for (let offset = 0; offset <= span; offset += 1) {
      const date = addDays(query.startDate, offset);
      const random = deterministicSource(`${query.destination}|weather|${date}`);

      const monthIndex = Number.parseInt(date.slice(5, 7), 10) - 1;
      const normalHigh = profile.monthlyHighC[monthIndex] ?? 20;

      const temperatureMaxC = Math.round((normalHigh + random.float(-3.5, 3.5)) * 10) / 10;
      const temperatureMinC = Math.round((temperatureMaxC - random.float(6, 11)) * 10) / 10;

      // Warmer months are drier in these regions.
      const rainBase = normalHigh >= 28 ? 0.08 : normalHigh >= 22 ? 0.18 : 0.32;
      const precipitationProbability =
        Math.round(random.float(rainBase, rainBase + 0.25) * 100) / 100;

      const seaTemperatureC = profile.hasBeach
        ? Math.round((normalHigh - random.float(3, 7)) * 10) / 10
        : null;

      outlook.push({
        date,
        temperatureMinC,
        temperatureMaxC,
        precipitationProbability,
        windKph: Math.round(random.float(6, 34)),
        seaTemperatureC,
        confidence: confidenceForLeadTime(daysBetween(MOCK_TODAY, date)),
      });
    }

    return ok(outlook);
  }
}

export function createMockWeatherProvider(): WeatherProvider {
  return new MockWeatherProvider();
}
