import { describe, expect, it } from 'vitest';
import { allAirports } from '@/providers/reference/airports';
import { candidatesFor, ORIGIN_TABLE, type AirportPoint } from './candidates';
import { compareCandidates, type CandidateInput } from './compare';
import { selfTransferWarning, SELF_TRANSFER_WARNING_KEY } from './self-transfer';

const points: AirportPoint[] = allAirports().map((a) => ({
  code: a.code,
  latitude: a.position[1],
  longitude: a.position[0],
  size: a.size,
}));

// Seeded LCG: deterministic property loop (fast-check is not installed).
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
const int = (r: () => number, max: number): number => Math.floor(r() * (max + 1));

function randomInputs(r: () => number): CandidateInput[] {
  const n = 1 + int(r, 5);
  return Array.from({ length: n }, (_, i) => ({
    code: `C${i}`,
    flightMinor: r() < 0.25 ? null : int(r, 100000),
    transferMinor: int(r, 8000),
  }));
}

describe('candidatesFor', () => {
  it('has real positions for every table origin and hub', () => {
    for (const [origin, { hubs }] of Object.entries(ORIGIN_TABLE)) {
      for (const c of [origin, ...hubs]) expect(points.some((p) => p.code === c)).toBe(true);
    }
  });

  it('gives Kosice the listed hubs BUD and KRK with an estimate', () => {
    const list = candidatesFor('KSC', points);
    expect(list[0]?.code).toBe('KSC');
    expect(list.map((c) => c.code)).toEqual(expect.arrayContaining(['BUD', 'KRK']));
    const bud = list.find((c) => c.code === 'BUD');
    expect(bud?.basis).toBe('estimate');
    expect(bud?.transferCost.amount).toBeGreaterThan(0);
  });

  it('keeps nearby airports within the configurable distance', () => {
    const narrow = candidatesFor('BUD', points, { maxGroundKm: 100 });
    expect(narrow.filter((c) => c.reason === 'nearby')).toHaveLength(0);
    for (const c of candidatesFor('BUD', points).filter((x) => x.reason === 'nearby')) {
      expect(c.distanceKm).toBeLessThanOrEqual(250);
    }
  });

  it('is empty for an unknown origin and deterministic', () => {
    expect(candidatesFor('ZZZ', points)).toEqual([]);
    expect(candidatesFor('VIE', points)).toEqual(candidatesFor('VIE', points));
  });
});

describe('compareCandidates properties', () => {
  it('total, cheapest, saving, unpriced and determinism hold for random input', () => {
    const r = rng(42);
    for (let i = 0; i < 500; i++) {
      const inputs = randomInputs(r);
      const result = compareCandidates('C0', inputs);
      for (const c of result.compared) {
        expect(c.totalMinor).toBe(c.flightMinor + c.transferMinor);
        expect(result.cheapest!.totalMinor).toBeLessThanOrEqual(c.totalMinor);
      }
      expect(result.savingMinor).toBeGreaterThanOrEqual(0);
      const unpriced = inputs.filter((x) => x.flightMinor === null).map((x) => x.code);
      if (result.cheapest) expect(unpriced).not.toContain(result.cheapest.code);
      expect([...result.notCompared].sort()).toEqual([...unpriced].sort());
      expect(compareCandidates('C0', inputs)).toEqual(result);
    }
  });

  it('respects both thresholds exactly at the boundary', () => {
    const at = (saving: number, base: number, t = {}) =>
      compareCandidates(
        'A',
        [
          { code: 'A', flightMinor: base, transferMinor: 0 },
          { code: 'B', flightMinor: base - saving, transferMinor: 0 },
        ],
        t,
      ).material;
    expect(at(1500, 15000)).toBe(true); // exactly 1500 and exactly 10 percent
    expect(at(1499, 14990)).toBe(false); // one short on money
    expect(at(1500, 15001)).toBe(false); // one short on percent
    expect(at(1500, 15000, { minSavingMinor: 1501 })).toBe(false);
    expect(at(1000, 5000, { minSavingMinor: 1000, minSavingPercent: 20 })).toBe(true);
  });

  it('is quiet without a requested price and never compares an unpriced candidate', () => {
    const r = compareCandidates('A', [
      { code: 'A', flightMinor: null, transferMinor: 0 },
      { code: 'B', flightMinor: 100, transferMinor: 0 },
    ]);
    expect(r.requested).toBeNull();
    expect(r.savingMinor).toBe(0);
    expect(r.material).toBe(false);
  });

  it('counts the transfer in the total', () => {
    const r = compareCandidates('A', [
      { code: 'A', flightMinor: 20000, transferMinor: 0 },
      { code: 'B', flightMinor: 12000, transferMinor: 2500 },
    ]);
    expect(r.cheapest?.code).toBe('B');
    expect(r.savingMinor).toBe(5500);
    expect(r.material).toBe(true);
  });
});

describe('selfTransferWarning', () => {
  it('warns only for more than one ticket and returns a key', () => {
    expect(selfTransferWarning(0)).toBeNull();
    expect(selfTransferWarning(1)).toBeNull();
    expect(selfTransferWarning(2)).toBe(SELF_TRANSFER_WARNING_KEY);
    expect(() => selfTransferWarning(-1)).toThrow();
  });
});
