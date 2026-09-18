import { money } from '@/core/money';
import type { FlightLeg, FlightOffer, FlightSegment } from '@/core/trip/types';
import { ok } from '@/lib/result';
import { atTime, deterministicSource, MOCK_OBSERVED_AT } from '../fixtures/deterministic';
import { resolveDestination } from '../fixtures/destinations';
import type {
  FlightProvider,
  FlightSearchQuery,
  ProviderHealth,
  ProviderRequestOptions,
  ProviderResult,
} from '../types';

/**
 * Mock flight provider.
 *
 * Serves deterministic fixtures so the search pipeline, cost engine and Travel
 * Watch loop can be built and tested with no provider contract, no credentials
 * and no network. Swapping in a real provider means writing a sibling module
 * that satisfies `FlightProvider` and registering it - nothing downstream moves.
 */

const CARRIERS = [
  { code: 'OS', name: 'Austrian' },
  { code: 'W6', name: 'Wizz Air' },
  { code: 'FR', name: 'Ryanair' },
  { code: 'LH', name: 'Lufthansa' },
  { code: 'TK', name: 'Turkish Airlines' },
] as const;

const CONNECTION_HUBS = ['MUC', 'FRA', 'IST', 'ZRH', 'WAW'] as const;

function buildSegment(
  origin: string,
  destination: string,
  date: string,
  departHour: number,
  departMinute: number,
  durationMinutes: number,
  carrier: (typeof CARRIERS)[number],
  flightNumber: number,
): FlightSegment {
  const departsAtMinutes = departHour * 60 + departMinute;
  const arrivesAtMinutes = departsAtMinutes + durationMinutes;

  return {
    origin,
    destination,
    departsAt: atTime(date, departHour, departMinute),
    // Mock data never rolls past midnight, which keeps arrival-day arithmetic
    // in the usable-time engine simple to reason about in tests.
    arrivesAt: atTime(date, Math.min(23, Math.floor(arrivesAtMinutes / 60)), arrivesAtMinutes % 60),
    carrier: carrier.code,
    flightNumber: `${carrier.code}${flightNumber}`,
  };
}

function buildLeg(
  origin: string,
  destination: string,
  date: string,
  seed: string,
  index: number,
  directOnly: boolean,
): FlightLeg {
  const random = deterministicSource(`${seed}:leg:${origin}:${destination}:${date}:${index}`);
  const profile = resolveDestination(destination === origin ? origin : destination);
  const carrier = random.pick(CARRIERS);

  // Budget carriers sell baggage separately; that difference matters to the
  // cost engine and to the No-Surprise check, so it is modelled explicitly.
  const isBudgetCarrier = carrier.code === 'W6' || carrier.code === 'FR';
  const direct = directOnly || random.chance(0.6);

  const departHour = random.int(6, 19);
  const departMinute = random.pick([0, 5, 15, 20, 30, 40, 45, 55]);
  const baseDuration = profile.typicalFlightMinutes;

  if (direct) {
    return {
      segments: [
        buildSegment(
          origin,
          destination,
          date,
          departHour,
          departMinute,
          baseDuration,
          carrier,
          random.int(100, 999),
        ),
      ],
      durationMinutes: baseDuration,
      cabinBaggageIncluded: true,
      checkedBaggageIncluded: !isBudgetCarrier,
      selfTransfer: false,
    };
  }

  const hub = random.pick(CONNECTION_HUBS);
  const firstLegMinutes = Math.round(baseDuration * 0.55);
  const layoverMinutes = random.int(55, 180);
  const secondLegMinutes = Math.round(baseDuration * 0.65);
  const totalMinutes = firstLegMinutes + layoverMinutes + secondLegMinutes;

  const secondDepartMinutes = departHour * 60 + departMinute + firstLegMinutes + layoverMinutes;

  return {
    segments: [
      buildSegment(
        origin,
        hub,
        date,
        departHour,
        departMinute,
        firstLegMinutes,
        carrier,
        random.int(100, 999),
      ),
      buildSegment(
        hub,
        destination,
        date,
        Math.min(23, Math.floor(secondDepartMinutes / 60)),
        secondDepartMinutes % 60,
        secondLegMinutes,
        carrier,
        random.int(100, 999),
      ),
    ],
    durationMinutes: totalMinutes,
    cabinBaggageIncluded: true,
    checkedBaggageIncluded: !isBudgetCarrier,
    // Separate-ticket connections are the expensive surprise in section 31.5.
    selfTransfer: isBudgetCarrier && random.chance(0.5),
  };
}

export class MockFlightProvider implements FlightProvider {
  readonly metadata = {
    id: 'mock-flights',
    kind: 'flights',
    displayName: 'Mock Flight Provider',
    isMock: true,
    rateLimitPerMinute: null,
  } as const;

  async checkHealth(_options?: ProviderRequestOptions): Promise<ProviderHealth> {
    return {
      status: 'healthy',
      checkedAt: MOCK_OBSERVED_AT,
      latencyMs: 0,
      message: 'Mock provider; no network call performed.',
    };
  }

  async searchFlights(
    query: FlightSearchQuery,
    _options?: ProviderRequestOptions,
  ): Promise<ProviderResult<readonly FlightOffer[]>> {
    const maxResults = query.maxResults ?? 6;
    const offers: FlightOffer[] = [];

    for (const origin of query.origins) {
      for (const destination of query.destinations) {
        const seed = [
          origin,
          destination,
          query.departureDate,
          query.returnDate,
          query.passengers,
          query.currency,
        ].join('|');

        const random = deterministicSource(seed);
        const profile = resolveDestination(destination);
        const offersForRoute = Math.min(3, Math.max(1, random.int(1, 3)));

        for (let index = 0; index < offersForRoute; index += 1) {
          const outbound = buildLeg(
            origin,
            destination,
            query.departureDate,
            seed,
            index,
            query.directOnly ?? false,
          );
          const inbound = buildLeg(
            destination,
            origin,
            query.returnDate,
            seed,
            index + 100,
            query.directOnly ?? false,
          );

          // Price varies around the destination baseline; connections and
          // missing baggage make an offer cheaper, exactly as in reality.
          const variation = random.float(0.78, 1.34);
          const connectionDiscount = outbound.segments.length > 1 ? 0.88 : 1;
          const baggageDiscount = outbound.checkedBaggageIncluded ? 1 : 0.82;

          const perPassenger = Math.round(
            profile.baselineFlightCents * variation * connectionDiscount * baggageDiscount,
          );

          offers.push({
            id: `mock-flight-${origin}-${destination}-${query.departureDate}-${index}`,
            providerId: this.metadata.id,
            outbound,
            inbound,
            price: money(perPassenger * query.passengers, query.currency),
            observedAt: MOCK_OBSERVED_AT,
            deepLink: undefined,
          });
        }
      }
    }

    const sorted = offers.sort((a, b) => a.price.amount - b.price.amount).slice(0, maxResults);

    return ok(sorted);
  }
}

export function createMockFlightProvider(): FlightProvider {
  return new MockFlightProvider();
}
