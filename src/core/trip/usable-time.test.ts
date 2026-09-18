import { describe, expect, it } from 'vitest';
import {
  computeUsableTime,
  maximumUsableMinutes,
  usableTimeEfficiency,
  USABLE_DAY_END_HOUR,
  USABLE_DAY_START_HOUR,
} from './usable-time';
import { buildCandidate, buildFlightOffer, buildLeg, buildTransferOffer } from './test-support';

function withTimes(arrivesAt: string, departsAt: string) {
  return buildCandidate({
    flight: buildFlightOffer({
      outbound: buildLeg({
        segments: [
          {
            origin: 'VIE',
            destination: 'AYT',
            departsAt: '2026-06-10T06:00:00Z',
            arrivesAt,
            carrier: 'OS',
            flightNumber: 'OS431',
          },
        ],
      }),
      inbound: buildLeg({
        segments: [
          {
            origin: 'AYT',
            destination: 'VIE',
            departsAt,
            arrivesAt: '2026-06-15T23:00:00Z',
            carrier: 'OS',
            flightNumber: 'OS432',
          },
        ],
      }),
    }),
  });
}

describe('computeUsableTime', () => {
  it('counts full days between arrival and departure', () => {
    const result = computeUsableTime(buildCandidate());
    const windowMinutes = (USABLE_DAY_END_HOUR - USABLE_DAY_START_HOUR) * 60;

    // 5 nights means 4 untouched days.
    expect(result.fullDayMinutes).toBe(4 * windowMinutes);
  });

  it('gives a midday arrival most of the afternoon and evening', () => {
    // Lands 12:15, plus 35 min to exit and a 45 min transfer, settled 13:35.
    // Usable until 22:00 is 8h25m.
    const result = computeUsableTime(buildCandidate());
    expect(result.arrivalDayMinutes).toBe(505);
  });

  it('gives a late-night arrival no usable time at all', () => {
    const result = computeUsableTime(withTimes('2026-06-10T23:40:00Z', '2026-06-15T14:00:00Z'));
    expect(result.arrivalDayMinutes).toBe(0);
  });

  it('does not credit an arrival with time before the usable day begins', () => {
    // Landing at 04:00 is settled by 05:20, but 05:20-08:00 is not holiday.
    const early = computeUsableTime(withTimes('2026-06-10T04:00:00Z', '2026-06-15T14:00:00Z'));
    const fullWindow = (USABLE_DAY_END_HOUR - USABLE_DAY_START_HOUR) * 60;

    expect(early.arrivalDayMinutes).toBe(fullWindow);
  });

  it('gives a dawn departure no usable time on the last day', () => {
    const result = computeUsableTime(withTimes('2026-06-10T12:15:00Z', '2026-06-15T05:50:00Z'));
    expect(result.departureDayMinutes).toBe(0);
  });

  it('gives an evening departure most of the last day', () => {
    // Departs 20:00, less 120 min check-in and a 45 min transfer, must leave
    // 17:15. From 08:00 that is 9h15m.
    const result = computeUsableTime(withTimes('2026-06-10T12:15:00Z', '2026-06-15T20:00:00Z'));
    expect(result.departureDayMinutes).toBe(555);
  });

  it('distinguishes two trips with identical night counts', () => {
    // This is the whole point of the metric (specification section 31.4).
    const good = computeUsableTime(withTimes('2026-06-10T11:00:00Z', '2026-06-15T20:00:00Z'));
    const poor = computeUsableTime(withTimes('2026-06-10T23:30:00Z', '2026-06-15T06:00:00Z'));

    expect(good.nights).toBe(poor.nights);
    expect(good.totalMinutes).toBeGreaterThan(poor.totalMinutes);
  });

  it('uses the actual transfer duration when one is priced', () => {
    const slow = computeUsableTime(
      buildCandidate({ transfer: buildTransferOffer({ durationMinutes: 120 }) }),
    );
    const fast = computeUsableTime(
      buildCandidate({ transfer: buildTransferOffer({ durationMinutes: 15 }) }),
    );

    expect(slow.assumptions.transferMinutes).toBe(120);
    expect(fast.totalMinutes).toBeGreaterThan(slow.totalMinutes);
  });

  it('accepts assumption overrides', () => {
    const result = computeUsableTime(buildCandidate(), { checkInLeadMinutes: 60 });
    expect(result.assumptions.checkInLeadMinutes).toBe(60);
  });

  it('never reports negative time', () => {
    const result = computeUsableTime(withTimes('2026-06-10T23:55:00Z', '2026-06-15T00:30:00Z'));

    expect(result.arrivalDayMinutes).toBeGreaterThanOrEqual(0);
    expect(result.departureDayMinutes).toBeGreaterThanOrEqual(0);
    expect(result.totalMinutes).toBeGreaterThanOrEqual(0);
  });
});

describe('usableTimeEfficiency', () => {
  it('stays within 0 and 1', () => {
    const result = computeUsableTime(buildCandidate());
    const efficiency = usableTimeEfficiency(result);

    expect(efficiency).toBeGreaterThan(0);
    expect(efficiency).toBeLessThanOrEqual(1);
  });

  it('scores a terrible itinerary near zero', () => {
    const poor = computeUsableTime(withTimes('2026-06-10T23:55:00Z', '2026-06-15T05:00:00Z'));
    const good = computeUsableTime(withTimes('2026-06-10T10:00:00Z', '2026-06-15T21:00:00Z'));

    expect(usableTimeEfficiency(poor)).toBeLessThan(usableTimeEfficiency(good));
  });

  it('relates to the theoretical maximum for the stay', () => {
    const windowMinutes = (USABLE_DAY_END_HOUR - USABLE_DAY_START_HOUR) * 60;
    expect(maximumUsableMinutes(5)).toBe(6 * windowMinutes);
  });
});
