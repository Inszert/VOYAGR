import { describe, expect, it } from 'vitest';
import {
  LAUNCH_DESTINATIONS,
  dailyCallCeiling,
  occupancySignature,
  ratesKey,
  snapshotTargets,
  targetId,
  targetKey,
  targetQuery,
} from './targets';

describe('snapshot targets', () => {
  const today = '2027-01-10';

  it('is every launch destination in three windows of four nights, today plus 30, 33 and 36', () => {
    const targets = snapshotTargets(today, 'us');

    expect(targets).toHaveLength(LAUNCH_DESTINATIONS.length * 3);
    const lisbon = targets.filter((target) => target.destination.code === 'LIS');
    expect(lisbon.map((target) => [target.checkIn, target.checkOut])).toEqual([
      ['2027-02-09', '2027-02-13'],
      ['2027-02-12', '2027-02-16'],
      ['2027-02-15', '2027-02-19'],
    ]);
    expect(lisbon[0]).toMatchObject({
      occupancy: { adults: 2, children: 0, rooms: 1 },
      currency: 'EUR',
      guestNationality: 'US',
    });
  });

  it('is deterministic: the same day gives the same targets, and the next day moves them', () => {
    expect(snapshotTargets(today, 'US')).toEqual(snapshotTargets(today, 'US'));
    expect(snapshotTargets('2027-01-11', 'US')[0]!.checkIn).toBe('2027-02-10');
  });

  it('has a stable occupancy signature', () => {
    expect(occupancySignature({ adults: 2, children: 0, rooms: 1 })).toBe('a2-c0-r1');
    expect(occupancySignature({ adults: 3, children: 1, rooms: 2 })).toBe('a3-c1-r2');
  });

  it('builds one key from a target and from a reader, in upper case', () => {
    const target = snapshotTargets(today, 'us')[0]!;

    expect(targetKey(target)).toEqual({
      destinationCode: 'LIS',
      checkIn: '2027-02-09',
      checkOut: '2027-02-13',
      occupancySig: 'a2-c0-r1',
      currency: 'EUR',
      guestNationality: 'US',
    });
    expect(
      ratesKey({
        destinationCode: 'lis',
        checkIn: '2027-02-09',
        checkOut: '2027-02-13',
        occupancy: { adults: 2, children: 0, rooms: 1 },
        currency: 'eur',
        guestNationality: 'us',
      }),
    ).toEqual(targetKey(target));
  });

  it('asks the vendor for the destination point, the window and the capped hotel count', () => {
    const query = targetQuery(snapshotTargets(today, 'US')[0]!);

    expect(query.destination.code).toBe('LIS');
    expect(query.destination.position).not.toBeNull();
    expect(query).toMatchObject({ checkIn: '2027-02-09', checkOut: '2027-02-13', maxResults: 20 });
  });

  it('names a window uniquely', () => {
    const ids = snapshotTargets(today, 'US').map(targetId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('computes the daily ceiling: 6 x 3 x 3 rates calls plus one content call a destination', () => {
    expect(dailyCallCeiling(6, 3, 3)).toBe(54 + 6);
    expect(dailyCallCeiling(6, 3, 24)).toBe(432 + 6);
  });
});
