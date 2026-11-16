import { describe, expect, it } from 'vitest';
import { buildFlightOffer, buildLeg } from '@/core/trip/test-support';
import { buildRankedTrip } from '@/components/search/test-support';
import type { WeatherOutlook } from '@/core/trip/types';
import { goodToKnow, seasonLine, seasonPhrase } from './trip-view';

const day = (date: string, min: number, max: number): WeatherOutlook => ({
  date,
  basis: 'climatology',
  temperatureMinC: min,
  temperatureMaxC: max,
  precipitationProbability: 0.2,
  windKph: 10,
  seaTemperatureC: null,
  confidence: 0.3,
});

describe('seasonPhrase', () => {
  it('names the part of the month the middle of the trip is in', () => {
    expect(seasonPhrase('2026-11-26', '2026-11-30')).toBe('Late November');
    expect(seasonPhrase('2026-06-01', '2026-06-05')).toBe('Early June');
    expect(seasonPhrase('2026-03-12', '2026-03-16')).toBe('Mid March');
  });
});

describe('seasonLine', () => {
  it('words the provider’s own figures and says they are typical', () => {
    const line = seasonLine('Rome', '2026-11-26', '2026-11-30', [
      day('2026-11-26', 11, 19),
      day('2026-11-27', 12, 18),
      day('2026-11-28', 13, 19),
    ]);

    expect(line).toEqual({
      text: 'Late November in Rome: mild days, cool evenings, 12–19°C',
      typical: true,
    });
  });

  it('says nothing when the provider gave nothing', () => {
    expect(seasonLine('Rome', '2026-11-26', '2026-11-30', [])).toBeNull();
  });
});

describe('goodToKnow', () => {
  it('turns "needs verification" into a sentence to check, in plain words', () => {
    const trip = buildRankedTrip();
    const items = goodToKnow({
      ...trip,
      warnings: [
        {
          code: 'BAGGAGE_ALLOWANCE_UNKNOWN',
          severity: 'needs_verification',
          message: 'This provider did not state the baggage allowance.',
        },
        {
          code: 'SELF_TRANSFER_UNKNOWN',
          severity: 'needs_verification',
          message: 'x',
        },
      ],
    });

    expect(items.map((item) => [item.kind, item.certainty, item.text])).toEqual([
      ['bag', 'check', 'Check the baggage allowance: the airline did not state it.'],
      ['ticket', 'check', 'Check that both flights are on one ticket.'],
    ]);
  });

  it('leaves excluded costs to the summary, which says them once', () => {
    const trip = buildRankedTrip();
    const items = goodToKnow({
      ...trip,
      warnings: [{ code: 'NO_TRANSFER_PRICED', severity: 'confirmed', message: 'x' }],
    });
    expect(items).toEqual([]);
  });

  it('asks the traveller to check a landing time nobody stated', () => {
    const leg = buildLeg();
    const unstated = {
      ...leg,
      segments: leg.segments.map((segment) => ({ ...segment, arrivesAt: null })),
    };
    const trip = buildRankedTrip({ flight: buildFlightOffer({ outbound: unstated }) });

    expect(goodToKnow({ ...trip, warnings: [] }).map((item) => item.key)).toEqual([
      'ARRIVAL_NOT_STATED',
    ]);
  });
});
