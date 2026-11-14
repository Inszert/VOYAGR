import { describe, expect, it } from 'vitest';
import { money } from '@/core/money';
import {
  buildFlightOffer,
  buildHotelOffer,
  buildLeg,
  buildTransferOffer,
  buildWeather,
} from '@/core/trip/test-support';
import { candidateId } from '@/core/trip/identity';
import {
  assembleRouteCandidates,
  flightDestination,
  flightOrigin,
  interleave,
  selectTransfer,
  weatherForWindow,
} from './assemble';
import { DEFAULT_SEARCH_LIMITS, type DateWindow, type SearchLimits } from './types';

const window: DateWindow = {
  departureDate: '2026-06-10',
  returnDate: '2026-06-15',
  nights: 5,
};

function routeInput(overrides: Partial<Parameters<typeof assembleRouteCandidates>[0]> = {}) {
  return {
    destination: 'AYT',
    destinationName: 'Antalya',
    window,
    passengers: 2,
    flights: [buildFlightOffer()],
    hotels: [buildHotelOffer()],
    transfers: [buildTransferOffer()],
    outlook: buildWeather(10),
    limits: DEFAULT_SEARCH_LIMITS as SearchLimits,
    ...overrides,
  };
}

describe('flight endpoints', () => {
  it('reads the origin and destination from the itinerary, not from a label', () => {
    const offer = buildFlightOffer();

    expect(flightOrigin(offer)).toBe('VIE');
    expect(flightDestination(offer)).toBe('AYT');
  });

  it('reads the final segment of a connecting itinerary', () => {
    const offer = buildFlightOffer({
      outbound: buildLeg({
        segments: [
          {
            origin: 'VIE',
            destination: 'IST',
            departsAt: '2026-06-10T09:00:00',
            arrivesAt: '2026-06-10T11:00:00',
            carrier: 'TK',
            flightNumber: 'TK1',
          },
          {
            origin: 'IST',
            destination: 'AYT',
            departsAt: '2026-06-10T13:00:00',
            arrivesAt: '2026-06-10T14:30:00',
            carrier: 'TK',
            flightNumber: 'TK2',
          },
        ],
      }),
    });

    expect(flightOrigin(offer)).toBe('VIE');
    expect(flightDestination(offer)).toBe('AYT');
  });

  it('reports null for an itinerary with no segments', () => {
    const offer = buildFlightOffer({ outbound: buildLeg({ segments: [] }) });

    expect(flightOrigin(offer)).toBeNull();
    expect(flightDestination(offer)).toBeNull();
  });
});

describe('weatherForWindow', () => {
  it('keeps both travel days and drops the rest', () => {
    const days = weatherForWindow(buildWeather(10), window);

    expect(days).toHaveLength(6);
    expect(days[0]?.date).toBe('2026-06-10');
    expect(days.at(-1)?.date).toBe('2026-06-15');
  });

  it('returns an empty outlook rather than failing when weather is missing', () => {
    // An empty forecast scores neutrally; inventing one would not.
    expect(weatherForWindow([], window)).toEqual([]);
  });
});

describe('selectTransfer', () => {
  it('picks the cheapest offer', () => {
    const cheap = buildTransferOffer({ id: 'bus', pricePerDirection: money(500, 'EUR') });
    const dear = buildTransferOffer({ id: 'car', pricePerDirection: money(4200, 'EUR') });

    expect(selectTransfer([dear, cheap])?.id).toBe('bus');
  });

  it('returns null when nothing was priced', () => {
    // Null is what makes the cost engine emit an excluded line and a warning,
    // rather than quietly costing the trip as if the ride were free.
    expect(selectTransfer([])).toBeNull();
  });
});

describe('candidateId', () => {
  it('is derived from content, so a refresh produces the same id', () => {
    const flight = buildFlightOffer();
    const hotel = buildHotelOffer();

    expect(candidateId('VIE', 'AYT', window, flight, hotel)).toBe(
      candidateId('VIE', 'AYT', window, flight, hotel),
    );
  });

  it('distinguishes trips that differ in any component', () => {
    const flight = buildFlightOffer();
    const hotel = buildHotelOffer();
    const base = candidateId('VIE', 'AYT', window, flight, hotel);

    expect(candidateId('BTS', 'AYT', window, flight, hotel)).not.toBe(base);
    expect(candidateId('VIE', 'AYT', { ...window, nights: 6 }, flight, hotel)).not.toBe(base);
    expect(candidateId('VIE', 'AYT', window, buildFlightOffer({ id: 'other' }), hotel)).not.toBe(
      base,
    );
  });
});

describe('assembleRouteCandidates', () => {
  it('builds the cross product of the offers it keeps', () => {
    const candidates = assembleRouteCandidates(
      routeInput({
        flights: [buildFlightOffer({ id: 'f1' }), buildFlightOffer({ id: 'f2' })],
        hotels: [buildHotelOffer({ id: 'h1' }), buildHotelOffer({ id: 'h2' })],
      }),
    );

    expect(candidates).toHaveLength(4);
    expect(new Set(candidates.map((candidate) => candidate.id)).size).toBe(4);
  });

  it('copies the window onto the candidate exactly', () => {
    const [candidate] = assembleRouteCandidates(routeInput());

    expect(candidate?.dates).toEqual(window);
    expect(candidate?.destination).toBe('AYT');
    expect(candidate?.destinationName).toBe('Antalya');
    expect(candidate?.passengers).toBe(2);
  });

  it('keeps the cheapest offers when the per-route limits bite', () => {
    const flights = [
      buildFlightOffer({ id: 'dear', price: money(90000, 'EUR') }),
      buildFlightOffer({ id: 'cheap', price: money(20000, 'EUR') }),
      buildFlightOffer({ id: 'mid', price: money(50000, 'EUR') }),
    ];

    const candidates = assembleRouteCandidates(
      routeInput({ flights, limits: { ...DEFAULT_SEARCH_LIMITS, maxFlightOffersPerRoute: 1 } }),
    );

    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.flight.id).toBe('cheap');
  });

  it('caps the cross product at the per-route limit', () => {
    const candidates = assembleRouteCandidates(
      routeInput({
        flights: [buildFlightOffer({ id: 'f1' }), buildFlightOffer({ id: 'f2' })],
        hotels: [
          buildHotelOffer({ id: 'h1' }),
          buildHotelOffer({ id: 'h2' }),
          buildHotelOffer({ id: 'h3' }),
        ],
        limits: { ...DEFAULT_SEARCH_LIMITS, maxCandidatesPerRoute: 2 },
      }),
    );

    expect(candidates).toHaveLength(2);
  });

  it('produces nothing when there is no flight', () => {
    // The flight is the one part a trip cannot be assembled without.
    expect(assembleRouteCandidates(routeInput({ flights: [] }))).toEqual([]);
  });

  it('still assembles each flight, with no stay, when no hotel was priced', () => {
    const candidates = assembleRouteCandidates(
      routeInput({
        hotels: [],
        flights: [buildFlightOffer({ id: 'f1' }), buildFlightOffer({ id: 'f2' })],
      }),
    );

    expect(candidates).toHaveLength(2);
    expect(candidates.every((candidate) => candidate.hotel === null)).toBe(true);
    // The id says so, and is stable across runs.
    expect(candidates[0]?.id).toContain('no-stay');
    expect(new Set(candidates.map((candidate) => candidate.id)).size).toBe(2);
  });

  it('still assembles a trip when transfers and weather are unavailable', () => {
    const [candidate] = assembleRouteCandidates(routeInput({ transfers: [], outlook: [] }));

    expect(candidate?.transfer).toBeNull();
    expect(candidate?.weather).toEqual([]);
  });

  it('skips an itinerary it cannot describe', () => {
    const candidates = assembleRouteCandidates(
      routeInput({ flights: [buildFlightOffer({ outbound: buildLeg({ segments: [] }) })] }),
    );

    expect(candidates).toEqual([]);
  });

  it('is deterministic', () => {
    expect(assembleRouteCandidates(routeInput())).toEqual(assembleRouteCandidates(routeInput()));
  });
});

describe('interleave', () => {
  it('takes one from each group in turn, so a cap trims every group evenly', () => {
    expect(interleave([['a1', 'a2', 'a3'], ['b1', 'b2'], ['c1']])).toEqual([
      'a1',
      'b1',
      'c1',
      'a2',
      'b2',
      'a3',
    ]);
  });

  it('keeps every item', () => {
    const groups = [[1, 2, 3], [], [4], [5, 6]];
    expect([...interleave(groups)].sort()).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('handles no groups at all', () => {
    expect(interleave([])).toEqual([]);
  });
});
