import { describe, expect, it } from 'vitest';
import {
  bestSaving,
  flexOptions,
  MAX_FLEX_DAYS,
  oldestAgeMs,
  type FlexDayPrice,
} from './flex-dates';
import { money } from './money';

const NOW = Date.parse('2026-11-14T12:00:00.000Z');
const FRESH_AT = '2026-11-14T11:50:00.000Z';
const OLD_AT = '2026-11-12T00:00:00.000Z';

const price = (amount: number, observedAt: string | null = FRESH_AT, currency = 'EUR') =>
  [money(amount, currency), observedAt] as const;

function prices(entries: Record<string, readonly [ReturnType<typeof money>, string | null]>) {
  return new Map<string, FlexDayPrice>(
    Object.entries(entries).map(([day, [p, observedAt]]) => [day, { price: p, observedAt }]),
  );
}

const run = (map: Map<string, FlexDayPrice>, windowDays = 3, dep = '2026-12-10') =>
  flexOptions({
    departureDate: dep,
    returnDate: '2026-12-15',
    windowDays,
    prices: map,
    now: NOW,
  });

describe('flexOptions', () => {
  it('gives 2N+1 options with the same number of nights', () => {
    const options = run(new Map());

    expect(options).toHaveLength(7);
    expect(options.map((o) => o.offset)).toEqual([-3, -2, -1, 0, 1, 2, 3]);
    expect(options[0]).toMatchObject({ departureDate: '2026-12-07', returnDate: '2026-12-12' });
    expect(options[6]).toMatchObject({ departureDate: '2026-12-13', returnDate: '2026-12-18' });
  });

  it('degenerate window of zero is only the chosen day', () => {
    expect(run(new Map(), 0)).toHaveLength(1);
  });

  it('accepts the widest window and refuses one beyond it, or a fraction', () => {
    expect(run(new Map(), MAX_FLEX_DAYS)).toHaveLength(2 * MAX_FLEX_DAYS + 1);
    expect(() => run(new Map(), MAX_FLEX_DAYS + 1)).toThrow();
    expect(() => run(new Map(), -1)).toThrow();
    expect(() => run(new Map(), 1.5)).toThrow();
  });

  it('crosses a month and a year boundary without Date drift', () => {
    const options = flexOptions({
      departureDate: '2026-12-30',
      returnDate: '2027-01-04',
      windowDays: 3,
      prices: new Map(),
      now: NOW,
    });

    expect(options.map((o) => o.departureDate)).toEqual([
      '2026-12-27',
      '2026-12-28',
      '2026-12-29',
      '2026-12-30',
      '2026-12-31',
      '2027-01-01',
      '2027-01-02',
    ]);
    expect(options[6]!.returnDate).toBe('2027-01-07');
  });

  it('handles a leap day', () => {
    const options = flexOptions({
      departureDate: '2028-02-28',
      returnDate: '2028-03-02',
      windowDays: 1,
      prices: new Map(),
      now: NOW,
    });

    expect(options[2]!.departureDate).toBe('2028-02-29');
  });

  it('a day with no price is unknown, never interpolated', () => {
    const options = run(prices({ '2026-12-10': price(30000), '2026-12-12': price(20000) }));
    const between = options.find((o) => o.offset === 1)!;

    expect(between.price).toBeNull();
    expect(between.saving).toBeNull();
    expect(between.freshness).toBe('unknown');
    expect(between.observedAt).toBeNull();
  });

  it('computes the saving as chosen minus option, in Money', () => {
    const options = run(prices({ '2026-12-10': price(30000), '2026-12-08': price(21600) }));

    expect(options.find((o) => o.offset === -2)!.saving).toEqual(money(8400, 'EUR'));
    expect(options.find((o) => o.offset === 0)!.saving).toEqual(money(0, 'EUR'));
  });

  it('a dearer day has a negative saving', () => {
    const options = run(prices({ '2026-12-10': price(30000), '2026-12-11': price(32000) }));

    expect(options.find((o) => o.offset === 1)!.saving).toEqual(money(-2000, 'EUR'));
  });

  it('every saving is unknown when the chosen day itself is unpriced', () => {
    const options = run(prices({ '2026-12-08': price(21600) }));

    expect(options.every((o) => o.saving === null)).toBe(true);
    expect(bestSaving(options)).toBeNull();
  });

  it('mixed currency gives an unknown difference, not a converted one', () => {
    const options = run(
      prices({ '2026-12-10': price(30000), '2026-12-08': price(21600, FRESH_AT, 'USD') }),
    );
    const usd = options.find((o) => o.offset === -2)!;

    expect(usd.price).toEqual(money(21600, 'USD'));
    expect(usd.saving).toBeNull();
    expect(bestSaving(options)).toBeNull();
  });

  it('reads freshness through the flight limit: 30 minutes is the edge', () => {
    const options = run(
      prices({
        '2026-12-10': price(30000, new Date(NOW - 30 * 60_000).toISOString()),
        '2026-12-09': price(30000, new Date(NOW - 30 * 60_000 - 1).toISOString()),
        '2026-12-08': price(30000, null),
        '2026-12-11': price(30000, OLD_AT),
      }),
    );
    const at = (offset: number) => options.find((o) => o.offset === offset)!.freshness;

    expect(at(0)).toBe('fresh');
    expect(at(-1)).toBe('stale');
    expect(at(-2)).toBe('unknown');
    expect(at(1)).toBe('stale');
  });
});

describe('bestSaving', () => {
  it('picks the largest material saving', () => {
    const options = run(
      prices({
        '2026-12-10': price(30000),
        '2026-12-08': price(21600),
        '2026-12-12': price(25000),
      }),
    );
    const best = bestSaving(options)!;

    expect(best.option.offset).toBe(-2);
    expect(best.saving).toEqual(money(8400, 'EUR'));
  });

  it('is null when nothing is cheaper', () => {
    expect(
      bestSaving(run(prices({ '2026-12-10': price(30000), '2026-12-11': price(31000) }))),
    ).toBeNull();
  });

  it('the absolute bar is exact: 1500 counts, 1499 does not', () => {
    // 1500 of 100000 is 1.5%, so the relative bar needs its own look below.
    const at = (cheaper: number) =>
      bestSaving(run(prices({ '2026-12-10': price(30000), '2026-12-11': price(cheaper) })));

    // 3% of 30000 is 900 and the absolute floor is 1500, so the floor decides.
    expect(at(28500)).not.toBeNull();
    expect(at(28501)).toBeNull();
  });

  it('the relative bar is exact: 3% counts, just under does not', () => {
    // A 3% saving that also clears the absolute floor needs a dear trip.
    const at = (cheaper: number) =>
      bestSaving(run(prices({ '2026-12-10': price(100000), '2026-12-11': price(cheaper) })));

    expect(at(97000)).not.toBeNull();
    expect(at(97001)).toBeNull();
  });

  it('breaks a tie towards the day nearest the chosen one, then the earlier', () => {
    const options = run(
      prices({
        '2026-12-10': price(30000),
        '2026-12-07': price(20000),
        '2026-12-09': price(20000),
        '2026-12-11': price(20000),
      }),
    );

    // -1 and +1 are as near as each other; the earlier wins.
    expect(bestSaving(options)!.option.offset).toBe(-1);
  });

  it('counts a stale price: age is shown beside it, not hidden by dropping it', () => {
    const options = run(
      prices({ '2026-12-10': price(30000, OLD_AT), '2026-12-09': price(20000, OLD_AT) }),
    );

    expect(bestSaving(options)).not.toBeNull();
  });
});

describe('oldestAgeMs', () => {
  it('is the age of the oldest price shown', () => {
    const options = run(prices({ '2026-12-10': price(30000), '2026-12-09': price(20000, OLD_AT) }));

    expect(oldestAgeMs(options, NOW)).toBe(NOW - Date.parse(OLD_AT));
  });

  it('is unknown when any shown price is undated, and when none is shown', () => {
    expect(
      oldestAgeMs(run(prices({ '2026-12-10': price(30000), '2026-12-09': price(1, null) })), NOW),
    ).toBeNull();
    expect(oldestAgeMs(run(new Map()), NOW)).toBeNull();
  });
});
