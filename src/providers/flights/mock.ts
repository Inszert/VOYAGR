import { money } from '@/core/money';
import type { FlightLeg, FlightOffer, FlightSegment } from '@/core/trip/types';
import { ok } from '@/lib/result';
import { atLocalTime, deterministicSource, MOCK_OBSERVED_AT } from '../fixtures/deterministic';
import { resolveDestination } from '../fixtures/destinations';
import type {
  FlightProvider,
  FlightSearchQuery,
  ProviderPage,
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
    departsAt: atLocalTime(date, departHour, departMinute),
    // Mock data never rolls past midnight, which keeps arrival-day arithmetic
    // in the usable-time engine simple to reason about in tests.
    arrivesAt: atLocalTime(
      date,
      Math.min(23, Math.floor(arrivesAtMinutes / 60)),
      arrivesAtMinutes % 60,
    ),
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

  /*
   * Sometimes the vendor simply did not say.
   *
   * `FlightLeg.checkedBaggageIncluded` is `boolean | null` because that is
   * what real feeds are like, and the whole unknown branch hangs off it: a
   * hard requirement goes unproven rather than unmet, the No-Surprise check
   * raises `needs_verification` rather than a confirmed warning, scoring
   * takes half the penalty, and data confidence drops. None of that had a
   * fixture behind it, so none of it was ever seen on a page.
   *
   * One leg in six, deterministically, so a fixture search still produces a
   * mixture rather than a page where every offer is uncertain.
   */
  const baggageUnstated = random.chance(1 / 6);

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
      checkedBaggageIncluded: baggageUnstated ? null : !isBudgetCarrier,
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
    checkedBaggageIncluded: baggageUnstated ? null : !isBudgetCarrier,
    // Separate-ticket connections are the expensive surprise in section 31.5.
    selfTransfer: isBudgetCarrier && random.chance(0.5),
  };
}

/**
 * The mock's cursor.
 *
 * An offset behind an opaque-looking prefix, because a caller must not be able
 * to build one by hand: a real provider's cursor is a token whose meaning
 * belongs to the vendor, and the mock has to teach the same discipline.
 */
function encodeOffset(offset: number): string {
  return `mock-page-${offset}`;
}

function decodeOffset(cursor: string | undefined): number {
  if (!cursor) return 0;

  const parsed = Number.parseInt(cursor.replace('mock-page-', ''), 10);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
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
  ): Promise<ProviderResult<ProviderPage<FlightOffer>>> {
    const pageSize = query.maxResults ?? 6;
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
          // Unknown is not a discount. A price is only lower because a bag
          // is definitely excluded, never because nobody said either way.
          const baggageDiscount = outbound.checkedBaggageIncluded === false ? 0.82 : 1;

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
            expiresAt: null,
            deepLink: undefined,
          });
        }
      }
    }

    const sorted = offers.sort((a, b) => a.price.amount - b.price.amount);

    // The mock paginates for real. A fixture that always returned everything
    // in one call would leave the paging path untested until a live provider
    // exercised it in production, which is exactly the wrong moment.
    const offset = decodeOffset(query.cursor);
    const page = sorted.slice(offset, offset + pageSize);
    const nextOffset = offset + page.length;

    return ok({
      items: page,
      nextCursor: nextOffset < sorted.length ? encodeOffset(nextOffset) : null,
    });
  }
}

export function createMockFlightProvider(): FlightProvider {
  return new MockFlightProvider();
}
