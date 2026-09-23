import type { WeatherOutlook } from '@/core/trip/types';

/**
 * The weather, said the way a person would ask about it.
 *
 * "9 to 33°C across 61 days" is true and answers nothing: it is the coldest
 * night and the hottest afternoon of two months, and says neither what a
 * normal day is like nor whether it rains. This turns the provider's days
 * into what somebody planning actually wants - a typical day and night, how
 * many days are likely wet, and the same week by week, because the second
 * half of October is not the first half of November.
 *
 * Pure and deterministic: averages of the provider's own figures, rounded
 * once, here. A day counts as likely wet at a 50% chance of rain or more.
 * Days whose confidence is below half are climatology - the typical weather
 * for the date, not a forecast - and the summary says how many there are so
 * the page can say so.
 */

export type WeatherFeel = 'hot' | 'warm' | 'mild' | 'cool' | 'cold';

export interface WeatherPeriod {
  readonly startDate: string;
  readonly endDate: string;
  readonly days: number;
  /** Average daytime high, rounded to a whole degree. */
  readonly highC: number;
  /** Average night-time low, rounded to a whole degree. */
  readonly lowC: number;
  /** Days with at least an even chance of rain. */
  readonly rainyDays: number;
  /** Average sea temperature, where the provider gave one for every day. */
  readonly seaC: number | null;
  readonly feel: WeatherFeel;
}

export interface WeatherSummary {
  readonly overall: WeatherPeriod;
  readonly weeks: readonly WeatherPeriod[];
  /** Days that are a forecast rather than the season's typical weather. */
  readonly forecastDays: number;
}

/** A day counts as wet from this chance of rain. */
export const RAINY_DAY_CHANCE = 0.5;

/** Below this confidence a day is climatology, not a forecast. */
const FORECAST_CONFIDENCE = 0.5;

/** How warm a typical afternoon feels, by its average high. */
export function feelFor(highC: number): WeatherFeel {
  if (highC >= 30) return 'hot';
  if (highC >= 24) return 'warm';
  if (highC >= 17) return 'mild';
  if (highC >= 10) return 'cool';
  return 'cold';
}

function period(days: readonly WeatherOutlook[]): WeatherPeriod {
  const average = (values: readonly number[]) =>
    Math.round(values.reduce((total, value) => total + value, 0) / values.length);

  const highC = average(days.map((day) => day.temperatureMaxC));
  const seas = days.map((day) => day.seaTemperatureC);

  return {
    startDate: days[0]!.date,
    endDate: days[days.length - 1]!.date,
    days: days.length,
    highC,
    lowC: average(days.map((day) => day.temperatureMinC)),
    rainyDays: days.filter((day) => day.precipitationProbability >= RAINY_DAY_CHANCE).length,
    seaC: seas.every((sea): sea is number => sea !== null) ? average(seas) : null,
    feel: feelFor(highC),
  };
}

export function summariseWeather(days: readonly WeatherOutlook[]): WeatherSummary | null {
  if (days.length === 0) return null;

  const sorted = [...days].sort((a, b) => a.date.localeCompare(b.date));
  const weeks: WeatherPeriod[] = [];

  for (let start = 0; start < sorted.length; start += 7) {
    weeks.push(period(sorted.slice(start, start + 7)));
  }

  return {
    overall: period(sorted),
    weeks,
    forecastDays: sorted.filter((day) => day.confidence >= FORECAST_CONFIDENCE).length,
  };
}
