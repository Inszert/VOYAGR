import { describe, expect, it } from 'vitest';
import { money, toMajor } from '@/core/money';
import { buildRankedTrip } from '@/components/search/test-support';
import { buildDateBreakdown, dateGrid, dateWindowKey, pickHighlights } from './date-options';
import type { DateWindow, RankedTrip, SearchOutcome } from './types';

/**
 * The date breakdown.
 *
 * The properties being defended are all about honesty rather than arithmetic:
 * dates nobody found a trip for must not read as cheap, a sample must not read
 * as a complete calendar, and every figure must be one the engines produced.
 */

const WINDOWS: DateWindow[] = [
  { departureDate: '2026-06-10', returnDate: '2026-06-15', nights: 5 },
  { departureDate: '2026-06-17', returnDate: '2026-06-22', nights: 5 },
  { departureDate: '2026-06-24', returnDate: '2026-06-29', nights: 5 },
];

function tripOn(window: DateWindow, hotelPrice: number, id = window.departureDate): RankedTrip {
  return buildRankedTrip({
    id,
    dates: window,
    hotel: {
      ...buildRankedTrip().candidate.hotel,
      totalPrice: money(hotelPrice, 'EUR'),
    },
  });
}

function outcomeOf(trips: readonly RankedTrip[], windows: readonly DateWindow[] = WINDOWS) {
  return {
    results: trips,
    nearMisses: [],
    routeOffers: [],
    destinationSummaries: [],
    diagnostics: {
      plan: {
        dateWindows: windows,
        dateWindowsAvailable: 165,
        currency: 'EUR',
      },
    },
  } as unknown as SearchOutcome;
}

describe('buildDateBreakdown', () => {
  it('quotes the cheapest total the cost engine produced for each window', () => {
    const cheap = tripOn(WINDOWS[0]!, 30_000);
    const dear = tripOn(WINDOWS[1]!, 90_000);
    const breakdown = buildDateBreakdown(outcomeOf([cheap, dear]));

    expect(breakdown.options[0]?.cheapestTotal).toEqual(cheap.cost.total);
    expect(breakdown.options[1]?.cheapestTotal).toEqual(dear.cost.total);
  });

  it('keeps a window nobody found a trip for, priced at nothing rather than zero', () => {
    // The distinction the whole module turns on. A window dropped, or drawn as
    // a zero-length bar, invites "we found nothing" to be read as "this is
    // cheap" - which is the one misreading that costs the user money.
    const breakdown = buildDateBreakdown(outcomeOf([tripOn(WINDOWS[0]!, 30_000)]));

    expect(breakdown.options).toHaveLength(3);
    expect(breakdown.options[1]?.cheapestTotal).toBeNull();
    expect(breakdown.options[1]?.tripCount).toBe(0);
  });

  it('lists the days that only have a flight, and not the days that already have a trip', () => {
    const outcome = {
      ...outcomeOf([tripOn(WINDOWS[0]!, 30_000)]),
      calendarFlights: [
        // The same departure as a priced trip: the trip is the better answer.
        {
          departureDate: '2026-06-10',
          returnDate: '2026-06-15',
          nights: 5,
          price: money(9_000, 'EUR'),
          destination: 'AYT',
        },
        {
          departureDate: '2026-06-12',
          returnDate: '2026-06-17',
          nights: 5,
          price: money(11_000, 'EUR'),
          destination: 'AYT',
        },
      ],
    } as unknown as SearchOutcome;

    const breakdown = buildDateBreakdown(outcome);

    expect(breakdown.flightOnly.map((flight) => flight.departureDate)).toEqual(['2026-06-12']);
  });

  it('never lets a flight-only day into the saving or the cheapest dates', () => {
    const outcome = {
      ...outcomeOf([tripOn(WINDOWS[0]!, 30_000), tripOn(WINDOWS[1]!, 90_000)]),
      calendarFlights: [
        {
          departureDate: '2026-06-12',
          returnDate: '2026-06-17',
          nights: 5,
          price: money(100, 'EUR'),
          destination: 'AYT',
        },
      ],
    } as unknown as SearchOutcome;

    const without = buildDateBreakdown(
      outcomeOf([tripOn(WINDOWS[0]!, 30_000), tripOn(WINDOWS[1]!, 90_000)]),
    );
    const withFlights = buildDateBreakdown(outcome);

    // A €1 flight on another day must not become the cheapest dates.
    expect(withFlights.saving).toEqual(without.saving);
    expect(withFlights.cheapest?.window.departureDate).toBe('2026-06-10');
  });

  it('states the saving between the cheapest and dearest priced dates', () => {
    const breakdown = buildDateBreakdown(
      outcomeOf([tripOn(WINDOWS[0]!, 30_000), tripOn(WINDOWS[1]!, 90_000)]),
    );

    expect(breakdown.cheapest?.window.departureDate).toBe('2026-06-10');
    expect(breakdown.dearest?.window.departureDate).toBe('2026-06-17');
    expect(breakdown.saving).toEqual(money(60_000, 'EUR'));
  });

  it('claims no saving when only one window produced a price', () => {
    // One window is not a choice, and a saving against nothing is not a saving.
    const breakdown = buildDateBreakdown(outcomeOf([tripOn(WINDOWS[0]!, 30_000)]));

    expect(breakdown.saving).toBeNull();
  });

  it('says when it sampled the window rather than covering it', () => {
    const breakdown = buildDateBreakdown(outcomeOf([tripOn(WINDOWS[0]!, 30_000)]));

    expect(breakdown.sampled).toBe(true);
    expect(breakdown.windowsPriced).toBe(3);
    expect(breakdown.windowsAllowed).toBe(165);
  });

  it('reports a complete search as complete', () => {
    const outcome = outcomeOf([tripOn(WINDOWS[0]!, 30_000)]);
    (outcome.diagnostics.plan as { dateWindowsAvailable: number }).dateWindowsAvailable = 3;

    expect(buildDateBreakdown(outcome).sampled).toBe(false);
  });

  it('returns windows in date order whatever order they were planned in', () => {
    const breakdown = buildDateBreakdown(outcomeOf([], [...WINDOWS].reverse()));

    expect(breakdown.options.map((option) => option.window.departureDate)).toEqual([
      '2026-06-10',
      '2026-06-17',
      '2026-06-24',
    ]);
  });

  it('carries the weakest weather confidence over the stay, not the average', () => {
    // Same rule as the provenance model: four forecast days do not make three
    // climatology days a forecast.
    const trip = buildRankedTrip({
      dates: WINDOWS[0]!,
      weather: [
        { ...buildRankedTrip().candidate.weather[0]!, confidence: 0.9 },
        { ...buildRankedTrip().candidate.weather[0]!, confidence: 0.3 },
      ],
    });

    expect(buildDateBreakdown(outcomeOf([trip])).options[0]?.weather?.confidence).toBe(0.3);
  });

  it('takes the worst day of rain over the stay, not the average', () => {
    const base = buildRankedTrip().candidate.weather[0]!;
    const trip = buildRankedTrip({
      dates: WINDOWS[0]!,
      weather: [
        { ...base, precipitationProbability: 0.1 },
        { ...base, precipitationProbability: 0.8 },
      ],
    });

    expect(buildDateBreakdown(outcomeOf([trip])).options[0]?.weather?.rainChance).toBe(0.8);
  });

  it('names the destination the quoted price belongs to', () => {
    // Different dates may favour a different city, and a price shown without
    // saying which would be a comparison the reader cannot check.
    const breakdown = buildDateBreakdown(outcomeOf([tripOn(WINDOWS[0]!, 30_000)]));

    expect(breakdown.options[0]?.destinationName).toBe('Antalya');
  });
});

describe('pickHighlights', () => {
  it('points at the cheapest dates', () => {
    const breakdown = buildDateBreakdown(
      outcomeOf([tripOn(WINDOWS[0]!, 90_000), tripOn(WINDOWS[1]!, 30_000)]),
    );

    expect(pickHighlights(breakdown).cheapest?.window.departureDate).toBe('2026-06-17');
  });

  it('prefers the driest dates for weather, warmest breaking a tie', () => {
    const base = buildRankedTrip().candidate.weather[0]!;
    const wet = buildRankedTrip({
      id: 'wet',
      dates: WINDOWS[0]!,
      weather: [{ ...base, precipitationProbability: 0.7 }],
    });
    const dry = buildRankedTrip({
      id: 'dry',
      dates: WINDOWS[1]!,
      weather: [{ ...base, precipitationProbability: 0.05 }],
    });

    expect(
      pickHighlights(buildDateBreakdown(outcomeOf([wet, dry]))).bestWeather?.window.departureDate,
    ).toBe('2026-06-17');
  });

  it('never highlights dates with no trip', () => {
    const highlights = pickHighlights(buildDateBreakdown(outcomeOf([tripOn(WINDOWS[0]!, 30_000)])));

    for (const option of [highlights.cheapest, highlights.bestValue, highlights.bestWeather]) {
      expect(option?.cheapestTotal ?? null).not.toBeNull();
    }
  });

  it('finds nothing to highlight in an empty search', () => {
    const highlights = pickHighlights(buildDateBreakdown(outcomeOf([])));

    expect(highlights.cheapest).toBeNull();
    expect(highlights.bestValue).toBeNull();
    expect(highlights.bestWeather).toBeNull();
  });
});

describe('dateWindowKey', () => {
  it('identifies a window by its two dates', () => {
    expect(dateWindowKey(WINDOWS[0]!)).toBe('2026-06-10..2026-06-15');
  });

  it('sorts as a date does', () => {
    // Relied on for ordering, so it must not be alphabetical by accident.
    expect(dateWindowKey(WINDOWS[0]!) < dateWindowKey(WINDOWS[2]!)).toBe(true);
  });
});

describe('money discipline', () => {
  it('never produces a total this module computed itself', () => {
    const trip = tripOn(WINDOWS[0]!, 30_000);
    const option = buildDateBreakdown(outcomeOf([trip])).options[0]!;

    // The quoted figure is the cost engine's, to the minor unit.
    expect(option.cheapestTotal?.amount).toBe(trip.cost.total.amount);
    expect(toMajor(option.cheapestTotal!)).toBe(toMajor(trip.cost.total));
  });
});

describe('dateGrid', () => {
  it('lays priced windows out by departure and length of stay, leaving gaps empty', () => {
    const windows: DateWindow[] = [
      { departureDate: '2026-06-10', returnDate: '2026-06-15', nights: 5 },
      { departureDate: '2026-06-10', returnDate: '2026-06-17', nights: 7 },
      { departureDate: '2026-06-12', returnDate: '2026-06-17', nights: 5 },
    ];
    const breakdown = buildDateBreakdown(
      outcomeOf(
        windows.map((window, index) => tripOn(window, 30_000 + index * 1_000, `trip-${index}`)),
        windows,
      ),
    );

    const grid = dateGrid(breakdown);

    expect(grid.departures).toEqual(['2026-06-10', '2026-06-12']);
    expect(grid.nights).toEqual([5, 7]);
    expect(grid.cells[0]!.map((cell) => cell?.window.departureDate ?? null)).toEqual([
      '2026-06-10',
      '2026-06-12',
    ]);
    // Seven nights from the 12th was never priced: an empty cell, not a guess.
    expect(grid.cells[1]![1]).toBeNull();
  });
});

describe('dateGrid pruning', () => {
  it('leaves out days and lengths that have no price at all', () => {
    const windows: DateWindow[] = [
      { departureDate: '2026-06-10', returnDate: '2026-06-15', nights: 5 },
      { departureDate: '2026-06-11', returnDate: '2026-06-21', nights: 10 },
    ];
    // Only the first window has a trip; the ten-night one on the 11th was priced to nothing.
    const breakdown = buildDateBreakdown(outcomeOf([tripOn(windows[0]!, 30_000)], windows));
    const grid = dateGrid(breakdown);

    expect(grid.departures).toEqual(['2026-06-10']);
    expect(grid.nights).toEqual([5]);
  });
});
