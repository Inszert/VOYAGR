import { describe, expect, it } from 'vitest';
import { money } from '@/core/money';
import { buildRankedTrip } from '@/components/search/test-support';
import { observationsFor } from './observations';

/**
 * What gets written to price history.
 *
 * The rule under test throughout: a price without provenance cannot honestly be
 * shown. Every row has to say who quoted it, when we saw it, in what currency
 * and under what conditions.
 */

const AT = '2026-09-19T12:00:00.000Z';

describe('observationsFor', () => {
  it('records the total and each part that was priced', () => {
    const rows = observationsFor('watch-1', buildRankedTrip(), AT);

    expect(rows.map((row) => row.componentType).sort()).toEqual([
      'flight',
      'hotel',
      'transfer',
      'trip_total',
    ]);
  });

  it('gives every row full provenance', () => {
    for (const row of observationsFor('watch-1', buildRankedTrip(), AT)) {
      expect(row.watchId).toBe('watch-1');
      expect(row.observedAt).toBe(AT);
      expect(row.providerId).toBeTruthy();
      expect(row.componentId).toBeTruthy();
      expect(row.amount.currency).toBe('EUR');
      expect(Number.isSafeInteger(row.amount.amount)).toBe(true);
    }
  });

  it('attributes the total to the cost engine, not to one provider', () => {
    // The total is assembled from several providers. Naming one would be a lie
    // about where the number came from.
    const total = observationsFor('watch-1', buildRankedTrip(), AT).find(
      (row) => row.componentType === 'trip_total',
    );

    expect(total?.providerId).toBe('voyagr.cost-engine');
  });

  it('records how much of a total was quoted rather than estimated', () => {
    // A cheap total that is mostly our own estimates is not the same
    // observation as one a provider stood behind.
    const total = observationsFor('watch-1', buildRankedTrip(), AT).find(
      (row) => row.componentType === 'trip_total',
    );

    expect(total?.conditions).toMatch(/^\d+% of this total was quoted by a provider$/);
  });

  it('carries the conditions the cost engine attached to each component', () => {
    const rows = observationsFor('watch-1', buildRankedTrip(), AT);

    expect(rows.find((row) => row.componentType === 'flight')?.conditions).toContain('baggage');
    expect(rows.find((row) => row.componentType === 'hotel')?.conditions).toBeTruthy();
  });

  it('points each component at the offer it came from', () => {
    const trip = buildRankedTrip();
    const rows = observationsFor('watch-1', trip, AT);

    // So "did this same hotel get cheaper?" is answerable later.
    expect(rows.find((row) => row.componentType === 'flight')?.componentId).toBe(
      trip.candidate.flight.id,
    );
    expect(rows.find((row) => row.componentType === 'hotel')?.componentId).toBe(
      trip.candidate.hotel!.id,
    );
  });

  it('records no transfer row rather than a zero when none was priced', () => {
    // A zero here would be a price nobody was ever offered, and it would poison
    // every later comparison against it.
    const rows = observationsFor('watch-1', buildRankedTrip({ transfer: null }), AT);

    expect(rows.some((row) => row.componentType === 'transfer')).toBe(false);
    expect(rows).toHaveLength(3);
  });

  it('records the total the cost engine produced, not a recomputed one', () => {
    const trip = buildRankedTrip();
    const total = observationsFor('watch-1', trip, AT).find(
      (row) => row.componentType === 'trip_total',
    );

    expect(total?.amount).toEqual(trip.cost.total);
  });

  it('is deterministic', () => {
    const trip = buildRankedTrip();
    expect(observationsFor('watch-1', trip, AT)).toEqual(observationsFor('watch-1', trip, AT));
  });

  it('keeps money as integer minor units', () => {
    const trip = buildRankedTrip();
    const rows = observationsFor('watch-1', trip, AT);

    expect(rows.find((row) => row.componentType === 'hotel')?.amount).toEqual(
      money(trip.candidate.hotel!.totalPrice.amount, 'EUR'),
    );
  });
});
