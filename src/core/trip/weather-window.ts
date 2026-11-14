import { daysBetween } from '../dates';
import type { IsoDate } from './types';

/**
 * How far ahead a weather forecast exists, and what that means for caching.
 *
 * Open-Meteo's free forecast reaches this many days from today, inclusive. Past
 * it nobody has a forecast, so the answer is the climate average for the dates
 * and it is labelled as such - never as a forecast.
 */
export const FORECAST_HORIZON_DAYS = 15;

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

/**
 * True when no day of the trip is inside the forecast horizon.
 *
 * Only then is the whole answer a climate average. A trip that starts inside the
 * horizon gets a forecast for the days that fit and averages for the rest, and
 * that mixed answer ages like a forecast.
 */
export function isBeyondForecastHorizon(today: IsoDate, startDate: IsoDate): boolean {
  return daysBetween(today, startDate) > FORECAST_HORIZON_DAYS;
}

export interface WeatherCachePolicy {
  readonly freshMs: number;
  readonly staleMs: number;
}

/**
 * How long an answer may be reused.
 *
 * A forecast is rewritten by the vendor several times a day, so it goes stale in
 * hours. A climate average is a normal over past years and does not move within
 * a month, so it is remembered for weeks - which also spares the vendor the
 * dozens of archive calls it takes to rebuild one.
 */
export function weatherCachePolicy(today: IsoDate, startDate: IsoDate): WeatherCachePolicy {
  return isBeyondForecastHorizon(today, startDate)
    ? { freshMs: 30 * DAY_MS, staleMs: 60 * DAY_MS }
    : { freshMs: 3 * HOUR_MS, staleMs: 3 * HOUR_MS };
}
