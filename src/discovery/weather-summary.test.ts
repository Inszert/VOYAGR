import { describe, expect, it } from 'vitest';
import type { WeatherOutlook } from '@/core/trip/types';
import { feelFor, summariseWeather } from './weather-summary';

/**
 * The weather summary.
 *
 * Defended: a typical day is the average of the provider's days, not the
 * extremes; wet days are counted at an even chance; weeks are seven days
 * each; and climatology is counted apart from forecast.
 */

function day(date: string, overrides: Partial<WeatherOutlook> = {}): WeatherOutlook {
  return {
    date,
    basis: 'climatology',
    temperatureMinC: 15,
    temperatureMaxC: 25,
    precipitationProbability: 0.2,
    windKph: 10,
    seaTemperatureC: 21,
    confidence: 0.3,
    ...overrides,
  };
}

const days = Array.from({ length: 10 }, (_, index) =>
  day(`2026-10-${String(index + 1).padStart(2, '0')}`, {
    temperatureMaxC: 20 + index,
    precipitationProbability: index % 3 === 0 ? 0.6 : 0.1,
    basis: index < 3 ? 'forecast' : 'climatology',
    confidence: index < 3 ? 0.9 : 0.3,
  }),
);

describe('summariseWeather', () => {
  it('says nothing about no days', () => {
    expect(summariseWeather([])).toBeNull();
  });

  it('describes a typical day by its averages, not its extremes', () => {
    const summary = summariseWeather(days)!;

    // Highs of 20 to 29 average 24.5, rounded once.
    expect(summary.overall.highC).toBe(25);
    expect(summary.overall.lowC).toBe(15);
    expect(summary.overall.feel).toBe('warm');
  });

  it('counts a day as wet from an even chance of rain', () => {
    expect(summariseWeather(days)!.overall.rainyDays).toBe(4);
  });

  it('splits the window into weeks of seven days', () => {
    const { weeks } = summariseWeather(days)!;

    expect(weeks.map((week) => week.days)).toEqual([7, 3]);
    expect(weeks[0]!.startDate).toBe('2026-10-01');
    expect(weeks[1]!.startDate).toBe('2026-10-08');
  });

  it('counts forecast days apart from the season’s typical weather', () => {
    expect(summariseWeather(days)!.forecastDays).toBe(3);
  });

  it('counts by the basis a day states, not by how confident it is', () => {
    // A low-confidence forecast is still a forecast; a climate average is
    // never one, however confident the vendor sounds.
    const mixed = [
      day('2026-10-01', { basis: 'forecast', confidence: 0.2 }),
      day('2026-10-02', { basis: 'climatology', confidence: 0.9 }),
    ];
    expect(summariseWeather(mixed)!.forecastDays).toBe(1);
  });

  it('gives no sea temperature unless every day has one', () => {
    const patchy = [day('2026-10-01'), day('2026-10-02', { seaTemperatureC: null })];
    expect(summariseWeather(patchy)!.overall.seaC).toBeNull();
  });
});

describe('feelFor', () => {
  it('names how an afternoon feels', () => {
    expect([32, 26, 19, 12, 4].map(feelFor)).toEqual(['hot', 'warm', 'mild', 'cool', 'cold']);
  });
});
