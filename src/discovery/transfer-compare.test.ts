import { describe, expect, it } from 'vitest';
import { money } from '@/core/money';
import type { TransferOffer } from '@/core/trip/types';
import { airportToCentreMetres, compareTransfers } from './transfer-compare';

function offer(mode: TransferOffer['mode'], minutes: number, cents: number, currency = 'EUR') {
  return {
    id: mode,
    providerId: 'mock',
    mode,
    durationMinutes: minutes,
    pricePerDirection: money(cents, currency),
    observedAt: '2026-11-16T00:00:00Z',
  } as TransferOffer;
}

describe('compareTransfers', () => {
  it('is nothing for no offers', () => {
    expect(compareTransfers([], 2)).toBeNull();
  });

  it('puts every bar on one scale so the fastest is the shortest', () => {
    const result = compareTransfers([offer('public', 54, 700), offer('taxi', 30, 4800)], 2)!;

    expect(result.scaleMinutes).toBe(54);
    expect(result.rows[0]!.barShare).toBe(1);
    expect(result.rows[1]!.barShare).toBeCloseTo(30 / 54);
  });

  it('labels the cheapest and the fastest, separately', () => {
    const result = compareTransfers(
      [offer('public', 54, 700), offer('taxi', 30, 4800), offer('shared', 40, 2000)],
      2,
    )!;

    expect(result.rows.filter((row) => row.cheapest).map((row) => row.offer.mode)).toEqual([
      'public',
    ]);
    expect(result.rows.filter((row) => row.fastest).map((row) => row.offer.mode)).toEqual(['taxi']);
  });

  it('gives a single option no label, because it has nothing to beat', () => {
    const [row] = compareTransfers([offer('taxi', 30, 4800)], 2)!.rows;

    expect(row!.cheapest).toBe(false);
    expect(row!.fastest).toBe(false);
  });

  it('does not rank prices in two currencies', () => {
    const result = compareTransfers([offer('public', 54, 700), offer('taxi', 30, 4800, 'GBP')], 2)!;

    expect(result.rows.some((row) => row.cheapest)).toBe(false);
  });

  it('takes the per-person share from core, rounded down, with the party total untouched', () => {
    const [row] = compareTransfers([offer('shared', 40, 10001)], 3)!.rows;

    expect(row!.party.amount).toBe(10001);
    expect(row!.each.amount).toBe(3333);
  });
});

describe('airportToCentreMetres', () => {
  it('measures with the core distance', () => {
    const metres = airportToCentreMetres([12.2389, 41.8003], [12.4964, 41.9028])!;

    expect(metres).toBeGreaterThan(20_000);
    expect(metres).toBeLessThan(30_000);
  });

  it('is null when either end is unknown or both are one point', () => {
    expect(airportToCentreMetres(null, [1, 1])).toBeNull();
    expect(airportToCentreMetres([1, 1], null)).toBeNull();
    expect(airportToCentreMetres([12.5, 41.9], [12.5, 41.9])).toBeNull();
  });
});
