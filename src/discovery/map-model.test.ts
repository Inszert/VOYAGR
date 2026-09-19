import { describe, expect, it } from 'vitest';
import { money } from '@/core/money';
import { buildRankedTrip } from '@/components/search/test-support';
import { summariseDestinations } from '@/search/destinations';
import type { RankedTrip, SearchOutcome } from '@/search/types';
import {
  buildMapPoints,
  MAP_MODES,
  MAP_MODE_LABELS,
  parseMapMode,
  TIER_MIN_ZOOM,
  toGeoJson,
  type DestinationGeo,
} from './map-model';

/**
 * The discovery map's model.
 *
 * What is defended here is the honesty of the map rather than its looks: a
 * destination we cannot place is never drawn somewhere plausible, every
 * ranking quotes a figure an engine produced, and a mode we cannot answer is
 * absent rather than silently ranked by something else.
 */

const PLACES: Record<string, DestinationGeo> = {
  AYT: { name: 'Antalya', country: 'Turkey', position: [30.79, 36.9], tier: 'major' },
  SPU: { name: 'Split', country: 'Croatia', position: [16.3, 43.54], tier: 'major' },
  ZZZ: { name: 'Nowhere', country: 'Nowhere', position: [0, 0], tier: 'local' },
};

const geo = (code: string): DestinationGeo | null => PLACES[code] ?? null;

function tripAt(destination: string, hotelPrice: number, overrides = {}): RankedTrip {
  return buildRankedTrip({
    id: `${destination}-${hotelPrice}`,
    destination,
    destinationName: PLACES[destination]?.name ?? destination,
    hotel: { ...buildRankedTrip().candidate.hotel, totalPrice: money(hotelPrice, 'EUR') },
    ...overrides,
  });
}

function outcomeOf(trips: readonly RankedTrip[]): SearchOutcome {
  return {
    results: trips,
    nearMisses: [],
    routeOffers: [],
    destinationSummaries: summariseDestinations(trips),
    diagnostics: {},
  } as unknown as SearchOutcome;
}

describe('buildMapPoints', () => {
  it('drops a destination it cannot place rather than guessing one', () => {
    // On a map an invented fact is unusually convincing: a dot on a coastline
    // looks like knowledge.
    const points = buildMapPoints({
      outcome: outcomeOf([tripAt('AYT', 30_000), tripAt('QQQ', 20_000)]),
      mode: 'cheapest',
      geo,
    });

    expect(points.map((point) => point.destination)).toEqual(['AYT']);
  });

  it('answers from every eligible trip, not from the page of results', () => {
    // The summaries cover all eligible trips; `results` is capped at forty.
    // Ranking from the page would drop the cheap places that lost on score,
    // which are the ones somebody browsing a map came for.
    const outcome = outcomeOf([tripAt('AYT', 90_000), tripAt('SPU', 20_000)]);
    (outcome as { results: readonly RankedTrip[] }).results = [];

    expect(
      buildMapPoints({ outcome, mode: 'cheapest', geo }).map((point) => point.destination),
    ).toEqual(['SPU', 'AYT']);
  });

  it('orders by the mode that was asked for', () => {
    const outcome = outcomeOf([tripAt('AYT', 90_000), tripAt('SPU', 20_000)]);

    expect(buildMapPoints({ outcome, mode: 'cheapest', geo })[0]?.destination).toBe('SPU');
  });

  it('quotes the cost engine, to the minor unit', () => {
    const cheap = tripAt('SPU', 20_000);
    const point = buildMapPoints({ outcome: outcomeOf([cheap]), mode: 'cheapest', geo })[0];

    expect(point?.cheapestTotal).toEqual(cheap.cost.total);
  });

  it('explains why each destination appears, in the mode chosen', () => {
    for (const mode of MAP_MODES) {
      const [point] = buildMapPoints({ outcome: outcomeOf([tripAt('AYT', 30_000)]), mode, geo });

      expect(point?.reason).toBeTruthy();
      // Section 14: do not hide the optimisation logic, and do not show a raw
      // score where a sentence belongs.
      expect(point?.reason).not.toMatch(/^[\d.]+$/);
    }
  });

  it('names the score it is ranking by in best-value mode', () => {
    const [point] = buildMapPoints({
      outcome: outcomeOf([tripAt('AYT', 30_000)]),
      mode: 'best-value',
      geo,
    });

    expect(point?.reason).toMatch(/out of 100/);
  });

  it('marks a long-range outlook as climatology rather than a forecast', () => {
    const base = buildRankedTrip().candidate.weather[0]!;
    const trip = tripAt('AYT', 30_000, {
      weather: [{ ...base, confidence: 0.2, precipitationProbability: 0.2 }],
    });

    const [point] = buildMapPoints({ outcome: outcomeOf([trip]), mode: 'best-weather', geo });

    expect(point?.reason).toContain('typical for the season');
  });

  it('is stable for the same search', () => {
    const outcome = outcomeOf([tripAt('AYT', 30_000), tripAt('SPU', 30_000)]);

    expect(buildMapPoints({ outcome, mode: 'cheapest', geo })).toEqual(
      buildMapPoints({ outcome, mode: 'cheapest', geo }),
    );
  });

  it('finds nothing to show for a search that found nothing', () => {
    expect(buildMapPoints({ outcome: outcomeOf([]), mode: 'cheapest', geo })).toEqual([]);
  });
});

describe('toGeoJson', () => {
  it('carries money in minor units with its currency', () => {
    // A map source is not somewhere to start doing money arithmetic in floats.
    const points = buildMapPoints({
      outcome: outcomeOf([tripAt('AYT', 30_000)]),
      mode: 'cheapest',
      geo,
    });
    const feature = toGeoJson(points, 'cheapest').features[0];

    expect(feature?.properties.totalMinorUnits).toBe(points[0]?.cheapestTotal?.amount);
    expect(feature?.properties.currency).toBe('EUR');
  });

  it('puts longitude first, as GeoJSON requires', () => {
    // Latitude first would put Antalya in the Indian Ocean.
    const points = buildMapPoints({
      outcome: outcomeOf([tripAt('AYT', 30_000)]),
      mode: 'cheapest',
      geo,
    });

    expect(toGeoJson(points, 'cheapest').features[0]?.geometry.coordinates).toEqual([30.79, 36.9]);
  });

  it('carries the zoom each place appears at', () => {
    const points = buildMapPoints({
      outcome: outcomeOf([tripAt('AYT', 30_000)]),
      mode: 'cheapest',
      geo,
    });

    expect(toGeoJson(points, 'cheapest').features[0]?.properties.minzoom).toBe(TIER_MIN_ZOOM.major);
  });
});

describe('parseMapMode', () => {
  it('opens on best value rather than on price', () => {
    // The product's claim is that the best trip is not usually the cheapest;
    // a discovery surface that opens on price teaches the opposite.
    expect(parseMapMode(undefined)).toBe('best-value');
    expect(parseMapMode('nonsense')).toBe('best-value');
  });

  it('accepts every mode it offers', () => {
    for (const mode of MAP_MODES) {
      expect(parseMapMode(mode)).toBe(mode);
      expect(MAP_MODE_LABELS[mode]).toBeTruthy();
    }
  });
});
