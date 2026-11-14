import { describe, expect, it } from 'vitest';
import {
  FORECAST_HORIZON_DAYS,
  isBeyondForecastHorizon,
  weatherCachePolicy,
} from './weather-window';

describe('isBeyondForecastHorizon', () => {
  it('treats the last day of the horizon as inside it, and the next as outside', () => {
    expect(isBeyondForecastHorizon('2026-11-14', '2026-11-29')).toBe(false);
    expect(FORECAST_HORIZON_DAYS).toBe(15);
    expect(isBeyondForecastHorizon('2026-11-14', '2026-11-30')).toBe(true);
  });

  it('treats today, and a date already past, as inside', () => {
    expect(isBeyondForecastHorizon('2026-11-14', '2026-11-14')).toBe(false);
    expect(isBeyondForecastHorizon('2026-11-14', '2026-11-01')).toBe(false);
  });
});

describe('weatherCachePolicy', () => {
  it('remembers a climate average for far longer than a forecast', () => {
    const forecast = weatherCachePolicy('2026-11-14', '2026-11-20');
    const climate = weatherCachePolicy('2026-11-14', '2027-06-15');

    expect(climate.freshMs).toBeGreaterThan(forecast.freshMs * 24);
    expect(forecast.freshMs).toBeLessThanOrEqual(6 * 3_600_000);
  });
});
