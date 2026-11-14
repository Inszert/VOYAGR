import { describe, expect, it } from 'vitest';
import { connectionCount, connectionsUnitemised } from './legs';
import type { FlightLeg, FlightSegment } from './types';

const segment = (origin: string, destination: string): FlightSegment => ({
  origin,
  destination,
  departsAt: '2026-12-07T13:05' as FlightSegment['departsAt'],
  arrivesAt: '2026-12-07T17:15' as FlightSegment['arrivesAt'],
  carrier: 'VF',
  flightNumber: 'VF336',
});

const leg = (segments: FlightSegment[], connectionsStated?: number): FlightLeg => ({
  segments,
  durationMinutes: 250,
  ...(connectionsStated === undefined ? {} : { connectionsStated }),
  cabinBaggageIncluded: null,
  checkedBaggageIncluded: null,
  selfTransfer: null,
});

describe('connectionCount', () => {
  it('is zero for one segment with nothing stated', () => {
    expect(connectionCount(leg([segment('PRG', 'AYT')]))).toBe(0);
  });

  it('counts itemised connections from the segments', () => {
    expect(connectionCount(leg([segment('PRG', 'SAW'), segment('SAW', 'AYT')]))).toBe(1);
  });

  it('reads a stated count when the connections are not itemised', () => {
    const stated = leg([segment('PRG', 'AYT')], 2);

    expect(connectionCount(stated)).toBe(2);
    expect(connectionsUnitemised(stated)).toBe(true);
  });

  it('never lets a short segment list hide a stated connection', () => {
    expect(connectionCount(leg([segment('PRG', 'SAW'), segment('SAW', 'AYT')], 1))).toBe(1);
    expect(connectionsUnitemised(leg([segment('PRG', 'SAW'), segment('SAW', 'AYT')], 1))).toBe(
      false,
    );
  });
});
