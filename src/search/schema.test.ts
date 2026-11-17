import { describe, expect, it } from 'vitest';
import {
  parseSearchForm,
  searchFormSchema,
  searchProfileToQuery,
  toSearchProfile,
  withMonthSelection,
} from './schema';

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

describe('searchProfileToQuery', () => {
  const roundTrip = (profile: ReturnType<typeof toSearchProfile>, destinations: string[]) => {
    const query = searchProfileToQuery(profile, destinations);
    const values: Record<string, string> = {};
    for (const [key, value] of new URLSearchParams(query)) values[key] = value;
    return parseSearchForm(values);
  };

  it('round-trips every field of a fully specified profile', () => {
    // The guard that matters: adding a field to SearchProfile and forgetting it
    // in the query builder fails here rather than silently dropping one of the
    // user's hard constraints when a saved search is re-run.
    const profile = toSearchProfile(
      searchFormSchema.parse({
        ...valid,
        reserveBudget: '120',
        minHotelReviewScore: '8.4',
        maxBeachDistanceMetres: '450',
        requireDirectFlights: 'on',
        requireCheckedBaggage: 'on',
        requireFreeCancellation: 'on',
      }),
    );

    const result = roundTrip(profile, ['AYT', 'CHQ']);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.request.profile).toEqual(profile);
    expect(result.value.request.destinations).toEqual(['AYT', 'CHQ']);
  });

  it('round-trips a profile with every optional field absent', () => {
    const profile = toSearchProfile(searchFormSchema.parse(valid));
    const result = roundTrip(profile, ['AYT']);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.request.profile).toEqual(profile);
  });

  it('keeps hard requirements that a partial link would have dropped', () => {
    const profile = toSearchProfile(
      searchFormSchema.parse({ ...valid, requireDirectFlights: 'on', minHotelReviewScore: '9' }),
    );

    const query = searchProfileToQuery(profile, ['AYT']);

    expect(query).toContain('requireDirectFlights=on');
    expect(query).toContain('minHotelReviewScore=9');
  });

  it('does not write a requirement the user did not set', () => {
    const profile = toSearchProfile(searchFormSchema.parse(valid));
    const query = searchProfileToQuery(profile, ['AYT']);

    expect(query).not.toContain('requireDirectFlights');
    expect(query).not.toContain('reserveBudget');
  });
});

describe('flexibility presets in the form', () => {
  /** The profile a submission resolves to, or a thrown test failure. */
  const profileFrom = (overrides: Record<string, string | undefined> = {}) => {
    const result = parse(overrides);
    if (!result.ok) throw new Error(`expected a valid form, got ${JSON.stringify(result.error)}`);
    return result.value.request.profile;
  };

  it('treats a submission with no flexibility field as a custom window', () => {
    // Every link written before the presets existed - including the one a
    // saved Travel Watch replays - sends exactly this.
    const profile = profileFrom();

    expect(profile.earliestDeparture).toBe('2026-06-01');
    expect(profile.latestReturn).toBe('2026-06-30');
    expect(profile.minNights).toBe(4);
    expect(profile.departureDaysOfWeek).toBeNull();
  });

  it('widens the typed dates when a preset is chosen', () => {
    const profile = profileFrom({
      flexibility: 'plus-minus-3',
      departureDate: '2026-06-06',
      returnDate: '2026-06-13',
    });

    expect(profile.earliestDeparture).toBe('2026-06-03');
    expect(profile.latestReturn).toBe('2026-06-16');
    // The window fields submitted alongside are ignored, not merged. A flexible
    // trip may be as short as the default floor and as long as the span plus
    // the give: seven nights, three either way, is two to ten.
    expect(profile.minNights).toBe(2);
    expect(profile.maxNights).toBe(10);
  });

  it('sets the day rules a weekend preset implies', () => {
    const profile = profileFrom({
      flexibility: 'weekend',
      departureDate: '2026-06-06',
      returnDate: '2026-06-08',
    });

    expect(profile.departureDaysOfWeek).toEqual([5, 6]);
    expect(profile.returnDaysOfWeek).toEqual([0]);
  });

  it('asks for the dates a preset needs rather than guessing them', () => {
    const result = parse({ flexibility: 'weekend', departureDate: '' });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.departureDate).toBeTruthy();
  });

  it('rejects a return before the departure', () => {
    const result = parse({
      flexibility: 'exact',
      departureDate: '2026-06-13',
      returnDate: '2026-06-06',
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.returnDate).toBeTruthy();
  });

  it('does not complain about a window the preset overrode', () => {
    // The window fields are derived when a preset is set, so a message about
    // one would name a field the user cannot see, let alone fix.
    const result = parse({
      flexibility: 'exact',
      departureDate: '2026-06-06',
      returnDate: '2026-06-13',
      minNights: '9',
      maxNights: '2',
    });

    expect(result.ok).toBe(true);
  });

  it('round-trips the day rules through a query string', () => {
    const profile = profileFrom({
      flexibility: 'long-weekend',
      departureDate: '2026-06-04',
      returnDate: '2026-06-07',
    });

    const query = Object.fromEntries(new URLSearchParams(searchProfileToQuery(profile, ['AYT'])));
    const result = parseSearchForm(query);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.request.profile).toEqual(profile);
  });

  it('writes the resolved dates, not the preset that produced them', () => {
    // A saved watch replays this string months later. Re-deriving "a weekend"
    // at replay time would slide it forward from whenever the worker ran, so
    // the watch would stop being the search that was saved.
    const profile = profileFrom({
      flexibility: 'weekend',
      departureDate: '2026-06-06',
      returnDate: '2026-06-08',
    });

    const query = new URLSearchParams(searchProfileToQuery(profile, ['AYT']));

    expect(query.get('flexibility')).toBeNull();
    expect(query.get('earliestDeparture')).toBe('2026-06-06');
    expect(query.get('departureDays')).toBe('5,6');
  });

  it('ignores a day list that is not days of the week', () => {
    expect(profileFrom({ departureDays: 'monday, 9, -1' }).departureDaysOfWeek).toBeNull();
  });
});

describe('anywhere as a destination', () => {
  const EVERYWHERE = ['AYT', 'CHQ', 'LIS'];

  const form = (destinations: string) => ({
    origins: 'VIE',
    destinations,
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
  });

  it('expands to everywhere we can actually price', () => {
    // A promise we can keep, not a wildcard.
    const parsed = parseSearchForm(form('anywhere'), EVERYWHERE);

    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.value.request.destinations).toEqual(EVERYWHERE);
  });

  it('accepts it however it was typed', () => {
    for (const typed of ['Anywhere', 'ANYWHERE', '  anywhere  ']) {
      const parsed = parseSearchForm(form(typed), EVERYWHERE);
      expect(parsed.ok).toBe(true);
    }
  });

  it('still refuses it when there is nowhere to expand to', () => {
    // Better an error than a search that silently looks nowhere.
    expect(parseSearchForm(form('anywhere'), []).ok).toBe(false);
  });

  it('leaves ordinary codes alone', () => {
    const parsed = parseSearchForm(form('AYT, CHQ'), EVERYWHERE);

    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.value.request.destinations).toEqual(['AYT', 'CHQ']);
  });
});

describe('withMonthSelection', () => {
  it('derives the two dates from a month and a trip length', () => {
    expect(
      withMonthSelection({
        flexibility: 'month',
        monthStart: '2026-12-01',
        tripNights: '5',
        departureDate: '2026-11-19',
        returnDate: '2026-11-26',
      }),
    ).toMatchObject({ departureDate: '2026-12-01', returnDate: '2026-12-06' });
  });

  it('defaults the trip to a week when the length is missing or unreadable', () => {
    expect(
      withMonthSelection({ flexibility: 'month', monthStart: '2026-12-01', tripNights: 'lots' })
        .returnDate,
    ).toBe('2026-12-08');
  });

  it('leaves the typed dates alone for any other preset or a bad month', () => {
    const typed = { flexibility: 'weekend', monthStart: '2026-12-01', departureDate: '2026-11-19' };
    expect(withMonthSelection(typed)).toBe(typed);

    const bad = { flexibility: 'month', monthStart: 'December', departureDate: '2026-11-19' };
    expect(withMonthSelection(bad)).toBe(bad);
  });
});

describe('part weights in the address', () => {
  it('are absent from the request by default', () => {
    const result = parse({});
    expect(result.ok && result.value.request.partWeights).toBeUndefined();
  });

  it('are read, clamped to the range and rounded to quarters', () => {
    const result = parse({ wFlights: '2', wStay: '0', wActivities: '1.3337', wTransfers: '1' });
    expect(result.ok && result.value.request.partWeights).toEqual({
      flights: 2,
      stay: 0,
      activities: 1.25,
      transfers: 1,
    });
  });

  it('fall back to normal when unreadable or out of range', () => {
    const result = parse({ wFlights: 'lots', wStay: '9', wActivities: '-1', wTransfers: '' });
    expect(result.ok && result.value.request.partWeights).toBeUndefined();
  });
});
