import { describe, expect, it } from 'vitest';
import { money } from '@/core/money';
import { buildRankedTrip } from '@/components/search/test-support';
import { summariseDestinations } from './destinations';

/**
 * Per-destination summaries.
 *
 * The property being defended: every figure belongs to one real trip. A
 * "cheapest total" assembled from the cheapest flight and the cheapest hotel
 * that never shared a date would be a price nobody can buy.
 */

function tripAt(destination: string, hotelPrice: number, id = `${destination}-${hotelPrice}`) {
  return buildRankedTrip({
    id,
    destination,
    hotel: { ...buildRankedTrip().candidate.hotel!, totalPrice: money(hotelPrice, 'EUR') },
  });
}

describe('summariseDestinations', () => {
  it('groups by destination and counts what it found', () => {
    const summaries = summariseDestinations([
      tripAt('AYT', 30_000),
      tripAt('AYT', 40_000),
      tripAt('SPU', 50_000),
    ]);

    expect(summaries).toHaveLength(2);
    expect(summaries.find((s) => s.destination === 'AYT')?.tripCount).toBe(2);
  });

  it('quotes one real trip, not a total assembled across trips', () => {
    const cheap = tripAt('AYT', 30_000);
    const [summary] = summariseDestinations([cheap, tripAt('AYT', 90_000)]);

    expect(summary?.cheapestTotal).toEqual(cheap.cost.total);
  });

  it('takes the best score at the destination, which need not be the cheapest trip', () => {
    // "This place is cheap" and "this place is good value" are different
    // claims, and the map makes them separately.
    const summaries = summariseDestinations([tripAt('AYT', 30_000), tripAt('AYT', 60_000)]);

    expect(summaries[0]?.bestScore).toBeGreaterThan(0);
  });

  it('reports the weakest weather confidence over the stay', () => {
    const base = buildRankedTrip().candidate.weather[0]!;
    const trip = buildRankedTrip({
      destination: 'AYT',
      weather: [
        { ...base, confidence: 0.9 },
        { ...base, confidence: 0.2 },
      ],
    });

    expect(summariseDestinations([trip])[0]?.weather?.confidence).toBe(0.2);
  });

  it('has no weather when none was fetched', () => {
    // A missing outlook is not a good one.
    const trip = buildRankedTrip({ destination: 'AYT', weather: [] });

    expect(summariseDestinations([trip])[0]?.weather).toBeNull();
  });

  it('summarises nothing from nothing', () => {
    expect(summariseDestinations([])).toEqual([]);
  });
});
