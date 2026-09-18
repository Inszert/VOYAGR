import { describe, expect, it } from 'vitest';
import { parseSearchForm, toSearchProfile, searchFormSchema } from './schema';

/**
 * The structured schema is the boundary every search crosses, whether it was
 * typed into a form, restored from a URL or, later, produced by the AI layer
 * from free text. These tests pin down what it accepts and what it refuses.
 */

const valid: Record<string, string> = {
  origins: 'VIE',
  destinations: 'AYT, CHQ',
  earliestDeparture: '2026-06-01',
  latestReturn: '2026-06-30',
  minNights: '4',
  maxNights: '7',
  passengers: '2',
  currency: 'EUR',
  targetBudget: '650',
  maxBudget: '850',
  travelStyle: 'balanced',
  optimisationMode: 'best_value',
};

const parse = (overrides: Record<string, string | undefined> = {}) =>
  parseSearchForm({ ...valid, ...overrides });

describe('parseSearchForm', () => {
  it('accepts a complete form', () => {
    const result = parse();

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.request.destinations).toEqual(['AYT', 'CHQ']);
    expect(result.value.request.profile.origins).toEqual(['VIE']);
    expect(result.value.request.profile.passengers).toBe(2);
  });

  it('converts budgets to Money in minor units, never a float', () => {
    const result = parse({ targetBudget: '650.55', maxBudget: '850', currency: 'eur' });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.request.profile.targetBudget).toEqual({ amount: 65055, currency: 'EUR' });
    expect(result.value.request.profile.maxBudget).toEqual({ amount: 85000, currency: 'EUR' });
  });

  it('normalises airport codes however they were typed', () => {
    const result = parse({ origins: 'vie bts', destinations: ' ayt,chq ' });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.request.profile.origins).toEqual(['VIE', 'BTS']);
    expect(result.value.request.destinations).toEqual(['AYT', 'CHQ']);
  });

  it('reads an absent checkbox as false, not as missing', () => {
    // An unchecked box submits nothing at all; treating that as undefined would
    // turn a hard requirement into a silent default.
    const off = parse();
    const on = parse({ requireDirectFlights: 'on' });

    expect(off.ok && off.value.request.profile.requireDirectFlights).toBe(false);
    expect(on.ok && on.value.request.profile.requireDirectFlights).toBe(true);
  });

  it('keeps optional numbers as null rather than zero', () => {
    // Zero is a real answer to "maximum distance to the beach". Absent is not.
    const result = parse({ minHotelReviewScore: '', maxBeachDistanceMetres: undefined });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.request.profile.minHotelReviewScore).toBeNull();
    expect(result.value.request.profile.maxBeachDistanceMetres).toBeNull();
    expect(result.value.request.profile.reserveBudget).toBeNull();
  });
});

describe('parseSearchForm rejects bad input', () => {
  const cases: ReadonlyArray<readonly [string, Record<string, string | undefined>, string]> = [
    ['a missing departure airport', { origins: '' }, 'origins'],
    ['an airport code that is not three letters', { origins: 'VIENNA' }, 'origins'],
    ['a missing destination', { destinations: '   ' }, 'destinations'],
    ['a date that does not exist', { earliestDeparture: '2026-02-30' }, 'earliestDeparture'],
    ['a return before the departure', { latestReturn: '2026-05-01' }, 'latestReturn'],
    ['a longest trip below the shortest', { minNights: '9', maxNights: '4' }, 'maxNights'],
    ['zero travellers', { passengers: '0' }, 'passengers'],
    ['more travellers than we price', { passengers: '20' }, 'passengers'],
    ['a maximum budget below the target', { maxBudget: '100' }, 'maxBudget'],
    ['a negative budget', { targetBudget: '-5' }, 'targetBudget'],
    ['a currency that is not a code', { currency: 'euros' }, 'currency'],
    ['an unknown travel style', { travelStyle: 'yolo' }, 'travelStyle'],
    ['a review score above ten', { minHotelReviewScore: '11' }, 'minHotelReviewScore'],
    ['a reserve larger than the target', { reserveBudget: '900' }, 'reserveBudget'],
  ];

  for (const [label, overrides, field] of cases) {
    it(`rejects ${label}`, () => {
      const result = parse(overrides);

      expect(result.ok).toBe(false);
      if (result.ok) return;

      // The message must name the field the user has to change, so the form can
      // put it beside the right input.
      expect(result.error[field as keyof typeof result.error]).toBeTruthy();
    });
  }

  it('reports one message per field rather than a pile', () => {
    const result = parse({ origins: 'NOPE' });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(Object.values(result.error).filter(Boolean)).toHaveLength(1);
  });
});

describe('toSearchProfile', () => {
  it('produces a profile the engines accept unchanged', () => {
    const values = searchFormSchema.parse(valid);
    const profile = toSearchProfile(values);

    expect(profile.targetBudget.currency).toBe(profile.maxBudget.currency);
    expect(profile.minNights).toBeLessThanOrEqual(profile.maxNights);
    expect(profile.earliestDeparture < profile.latestReturn).toBe(true);
  });
});
