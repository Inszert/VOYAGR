import { describe, expect, it } from 'vitest';
import { mergeAggregate, pruneRows, type PrunableRow } from './prune';

const NOW = '2027-03-10T03:00:00.000Z';

function row(departureDate: string, prices: number[], overrides: Partial<PrunableRow> = {}) {
  return {
    origin: 'VIE',
    destination: 'LIS',
    departureDate,
    currency: 'EUR',
    offers: prices.map((amount, i) => ({ id: `o${i}`, price: { amount, currency: 'EUR' } })),
    ...overrides,
  };
}

describe('pruneRows', () => {
  it('prunes a past row and keeps a future one, and today itself', () => {
    const past = row('2027-03-09', [10000]);
    const today = row('2027-03-10', [10000]);
    const future = row('2027-04-01', [10000]);
    const result = pruneRows([past, today, future], '2027-03-10', NOW);
    expect(result.toDelete).toEqual([past]);
    expect(result.keep).toEqual([today, future]);
  });

  it('computes median, min and count per route and month from the rows it deletes', () => {
    // Cheapest per row: 30000, 10000, 20000, 40000 -> sorted 10000 20000 30000 40000.
    const rows = [
      row('2027-02-03', [30000, 35000]),
      row('2027-02-10', [10000]),
      row('2027-02-17', [20000, 90000]),
      row('2027-02-24', [40000]),
    ];
    const { aggregates } = pruneRows(rows, '2027-03-10', NOW);
    expect(aggregates).toEqual([
      {
        origin: 'VIE',
        destination: 'LIS',
        month: '2027-02',
        currency: 'EUR',
        medianMinor: 25000,
        minMinor: 10000,
        sampleCount: 4,
        computedAt: NOW,
      },
    ]);
  });

  it('takes the middle value for an odd count and floors an odd mean', () => {
    const odd = pruneRows(
      [row('2027-02-01', [100]), row('2027-02-02', [300]), row('2027-02-03', [200])],
      '2027-03-10',
      NOW,
    );
    expect(odd.aggregates[0]?.medianMinor).toBe(200);
    const even = pruneRows([row('2027-02-01', [100]), row('2027-02-02', [101])], '2027-03-10', NOW);
    expect(even.aggregates[0]?.medianMinor).toBe(100);
  });

  it('keeps routes and months apart and ignores rows with no readable price', () => {
    const rows = [
      row('2027-01-30', [10000]),
      row('2027-02-01', [20000]),
      row('2027-02-02', [20000], { destination: 'OPO' }),
      row('2027-02-03', []),
      row('2027-02-04', [1], { offers: 'garbage' }),
    ];
    const { aggregates, toDelete } = pruneRows(rows, '2027-03-10', NOW);
    expect(toDelete).toHaveLength(5);
    expect(aggregates.map((a) => `${a.destination}${a.month}${a.sampleCount}`)).toEqual([
      'LIS2027-011',
      'LIS2027-021',
      'OPO2027-021',
    ]);
  });

  it('gives empty output for empty input', () => {
    expect(pruneRows([], '2027-03-10', NOW)).toEqual({ toDelete: [], keep: [], aggregates: [] });
  });

  it('is deterministic and does not mutate its input', () => {
    const rows = [row('2027-02-03', [300]), row('2027-02-10', [100]), row('2027-05-01', [5])];
    const snapshot = structuredClone(rows);
    expect(pruneRows(rows, '2027-03-10', NOW)).toEqual(pruneRows(rows, '2027-03-10', NOW));
    expect(rows).toEqual(snapshot);
  });
});

describe('mergeAggregate', () => {
  it('combines count and min exactly and weights the median by count', () => {
    const merged = mergeAggregate(
      { medianMinor: 100, minMinor: 80, sampleCount: 1 },
      {
        origin: 'VIE',
        destination: 'LIS',
        month: '2027-02',
        currency: 'EUR',
        medianMinor: 200,
        minMinor: 150,
        sampleCount: 3,
        computedAt: NOW,
      },
    );
    expect(merged).toMatchObject({ medianMinor: 175, minMinor: 80, sampleCount: 4 });
  });
});
