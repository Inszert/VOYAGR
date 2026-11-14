import { describe, expect, it } from 'vitest';
import type { DateWeather } from '@/search/date-options';
import { skyConditionOf } from './sky-condition';

const weather = (patch: Partial<DateWeather>): DateWeather => ({
  minC: 5,
  maxC: 20,
  confidence: 1,
  rainChance: 0.3,
  ...patch,
});

describe('skyConditionOf', () => {
  it('has no condition without an outlook', () => {
    expect(skyConditionOf(null)).toBeNull();
  });

  it('calls a cold stay snowy even when rain is likely', () => {
    expect(skyConditionOf(weather({ maxC: -3, rainChance: 0.8 }))).toBe('snowy');
  });

  it('calls a cold stay with some chance of precipitation snowy', () => {
    expect(skyConditionOf(weather({ maxC: 4, rainChance: 0.3 }))).toBe('snowy');
  });

  it('does not call a cold but dry stay snowy', () => {
    expect(skyConditionOf(weather({ maxC: 1, rainChance: 0.1 }))).toBe('dry');
  });

  it('calls a likely-rain stay rainy', () => {
    expect(skyConditionOf(weather({ rainChance: 0.8 }))).toBe('rainy');
  });

  it('calls a stay with almost no rain dry', () => {
    expect(skyConditionOf(weather({ rainChance: 0.2 }))).toBe('dry');
  });

  it('calls everything between mild', () => {
    expect(skyConditionOf(weather({ rainChance: 0.5 }))).toBe('mild');
  });
});
