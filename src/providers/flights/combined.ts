import { daysBetween, localDate, minutesIntoLocalDay } from '@/core/dates';
import { convert, type RateSource } from '@/core/fx';
import { connectionCount } from '@/core/trip/legs';
import type { ProviderMode } from '@/core/trip/provenance';
import type { FlightLeg, FlightOffer } from '@/core/trip/types';
import { concurrencyFor } from '../rate';
import { AppError } from '@/lib/errors';
import type { LimiterPool } from '@/lib/concurrency';
import { getLogger } from '@/lib/logger';
import { err, ok } from '@/lib/result';
import type {
  FlightProvider,
  FlightSearchQuery,
  ProviderHealth,
  ProviderMetadata,
  ProviderPage,
  ProviderRequestOptions,
  ProviderResult,
} from '../types';

/**
 * Several flight sources read as one.
 *
 * Aviasales is a sparse cache of other people's searches; Google Flights (an owner-approved,
 * off-by-default exception, see `docs/provider-policy.md`) is a scrape of live listings. Neither
 * is complete, so a search asks both and merges. Two rules decide what the merge may do:
 *
 * - **Never mix currencies.** An offer in another currency than the one asked for goes through
 *   `src/core/fx.ts` or is dropped with a named reason; it is never compared raw.
 * - **The same itinerary is one result.** Same airports, same stops and local departure and
 *   arrival within a few minutes on both legs: the cheaper price is kept and every provider that
 *   reported it is recorded. Different tickets for the same flights are still the same flights,
 *   so a dearer one is dropped - but at an equal price a single return ticket beats two one-way
 *   tickets, which protect the traveller less.
 *
 * `combineFlightOffers` is pure and is the part to reuse. `CombinedFlightProvider` is a thin
 * wrapper that gives each source its own limiter and lets one failing source degrade the answer
 * rather than abort it.
 */

const log = getLogger('providers.combined-flights');

/** Local clock faces differing by no more than this are the same departure. */
export const SAME_FLIGHT_TOLERANCE_MINUTES = 5;

export interface FlightSource {
  readonly providerId: string;
  readonly offers: readonly FlightOffer[];
}

export interface CombinedFlightOffer {
  readonly offer: FlightOffer;
  /** Every provider that listed this itinerary, in the order the sources were given. */
  readonly reportedBy: readonly string[];
}

export type DropReason =
  /** The offer is in another currency and no rate was available to bring it across. */
  | { readonly kind: 'no_rate'; readonly from: string; readonly to: string }
  /** The offer is in another currency and no rate source was given at all. */
  | { readonly kind: 'currency_mismatch'; readonly from: string; readonly to: string }
  /** The same itinerary at a higher price (or the same price from a less protective ticket). */
  | { readonly kind: 'duplicate'; readonly keptProviderId: string };

export interface DroppedOffer {
  readonly providerId: string;
  readonly offerId: string;
  readonly reason: DropReason;
}

export interface CombineOptions {
  /** The currency every returned price is in. */
  readonly currency: string;
  /** Needed to keep an offer quoted in another currency; without it such offers are dropped. */
  readonly rates?: RateSource;
  readonly toleranceMinutes?: number;
}

export interface CombineResult {
  readonly offers: readonly CombinedFlightOffer[];
  readonly dropped: readonly DroppedOffer[];
}

/** An instant on a local calendar, in minutes: comparable across midnight, never across zones. */
function localMinutes(value: string): number {
  return daysBetween('1970-01-01', localDate(value)) * 1440 + minutesIntoLocalDay(value);
}

function legAnchors(leg: FlightLeg) {
  const first = leg.segments[0]!;
  const last = leg.segments[leg.segments.length - 1]!;
  return {
    from: first.origin,
    to: last.destination,
    stops: connectionCount(leg),
    departs: localMinutes(first.departsAt),
    // Cached vendors state no arrival; an unknown arrival cannot contradict a known one.
    arrives: last.arrivesAt === null ? null : localMinutes(last.arrivesAt),
  };
}

function sameLeg(a: FlightLeg, b: FlightLeg, tolerance: number): boolean {
  const x = legAnchors(a);
  const y = legAnchors(b);

  if (x.from !== y.from || x.to !== y.to || x.stops !== y.stops) return false;
  if (Math.abs(x.departs - y.departs) > tolerance) return false;
  if (x.arrives !== null && y.arrives !== null && Math.abs(x.arrives - y.arrives) > tolerance) {
    return false;
  }
  return true;
}

/** True when two offers are the same trip: both legs match. */
export function sameItinerary(a: FlightOffer, b: FlightOffer, tolerance: number): boolean {
  return sameLeg(a.outbound, b.outbound, tolerance) && sameLeg(a.inbound, b.inbound, tolerance);
}

interface Candidate {
  readonly providerId: string;
  readonly offer: FlightOffer;
  readonly order: number;
}

/** Cheapest first; at a tie one return ticket beats two singles; then the source order given. */
function byPreference(a: Candidate, b: Candidate): number {
  return (
    a.offer.price.amount - b.offer.price.amount ||
    Number(a.offer.ticketing === 'two_one_way') - Number(b.offer.ticketing === 'two_one_way') ||
    a.order - b.order
  );
}

export function combineFlightOffers(
  sources: readonly FlightSource[],
  options: CombineOptions,
): CombineResult {
  const target = options.currency.toUpperCase();
  const tolerance = options.toleranceMinutes ?? SAME_FLIGHT_TOLERANCE_MINUTES;
  const dropped: DroppedOffer[] = [];
  const candidates: Candidate[] = [];

  let order = 0;
  for (const source of sources) {
    for (const original of source.offers) {
      order += 1;
      let offer = original;

      if (offer.price.currency !== target) {
        const from = offer.price.currency;
        if (!options.rates) {
          dropped.push({
            providerId: source.providerId,
            offerId: offer.id,
            reason: { kind: 'currency_mismatch', from, to: target },
          });
          continue;
        }

        const converted = convert(offer.price, target, options.rates);
        if (!converted.ok) {
          dropped.push({
            providerId: source.providerId,
            offerId: offer.id,
            reason: { kind: 'no_rate', from, to: target },
          });
          continue;
        }
        offer = { ...offer, price: converted.value };
      }

      candidates.push({ providerId: source.providerId, offer, order });
    }
  }

  candidates.sort(byPreference);

  const kept: { winner: Candidate; reportedBy: Set<string> }[] = [];
  for (const candidate of candidates) {
    const match = kept.find((entry) =>
      sameItinerary(entry.winner.offer, candidate.offer, tolerance),
    );

    if (match) {
      match.reportedBy.add(candidate.providerId);
      dropped.push({
        providerId: candidate.providerId,
        offerId: candidate.offer.id,
        reason: { kind: 'duplicate', keptProviderId: match.winner.providerId },
      });
    } else {
      kept.push({ winner: candidate, reportedBy: new Set([candidate.providerId]) });
    }
  }

  const providerOrder = new Map(sources.map((source, index) => [source.providerId, index]));
  const offers = kept
    .map(({ winner, reportedBy }) => ({
      offer: winner.offer,
      reportedBy: [...reportedBy].sort(
        (a, b) => (providerOrder.get(a) ?? 0) - (providerOrder.get(b) ?? 0),
      ),
    }))
    .sort(
      (a, b) =>
        // Every price is in the target currency by now, so the minor units compare directly.
        a.offer.price.amount - b.offer.price.amount ||
        a.offer.outbound.segments[0]!.departsAt.localeCompare(
          b.offer.outbound.segments[0]!.departsAt,
        ) ||
        a.offer.id.localeCompare(b.offer.id),
    );

  return { offers, dropped };
}

/** What one source did in one combined search. */
export interface SourceReport {
  readonly providerId: string;
  /** Adapter calls made. One per search; the adapter's own sub-calls are its business. */
  readonly calls: number;
  readonly offers: number;
  readonly failures: number;
  /** Why it failed, in the adapter's own words, or null. */
  readonly error: string | null;
}

export interface CombinedSearchReport {
  readonly sources: readonly SourceReport[];
  readonly dropped: readonly DroppedOffer[];
}

export interface CombinedSearch {
  readonly offers: readonly CombinedFlightOffer[];
  readonly report: CombinedSearchReport;
}

export interface CombinedFlightOptions {
  /** Preference order: it breaks price ties and orders `reportedBy`. */
  readonly providers: readonly FlightProvider[];
  /** The search's pool: each source gets the limiter that belongs to its vendor. */
  readonly limiters: LimiterPool;
  /** The most any one source may have in flight; its declared rate limit may lower it. */
  readonly ceiling?: number;
  readonly rates?: RateSource;
  /** Told about every search, so a caller can surface a degraded source as an issue. */
  readonly onReport?: (report: CombinedSearchReport) => void;
}

const MODE_WEAKEST_FIRST: readonly ProviderMode[] = [
  'mock',
  'test',
  'absent',
  'indicative',
  'live',
];

function weakestMode(providers: readonly FlightProvider[]): ProviderMode {
  const modes = providers.map(
    (provider) => provider.metadata.mode ?? (provider.metadata.isMock ? 'mock' : 'live'),
  );
  return MODE_WEAKEST_FIRST.find((mode) => modes.includes(mode)) ?? 'mock';
}

/**
 * Asks every source, each through its own limiter, and merges what comes back.
 *
 * A source that fails is a degraded search, not a failed one: the others still answer. Only when
 * every source fails does the search fail, and then with every cause in the message.
 *
 * It does **not** forward `monthFareSources` or `searchOneWay`: a scrape cannot answer a month,
 * so those stay on the provider that can, and the caller keeps using it directly for them.
 */
export class CombinedFlightProvider implements FlightProvider {
  readonly metadata: ProviderMetadata & { kind: 'flights' };

  private readonly providers: readonly FlightProvider[];
  private readonly limiters: LimiterPool;
  private readonly ceiling: number;
  private readonly rates: RateSource | undefined;
  private readonly onReport: ((report: CombinedSearchReport) => void) | undefined;

  constructor(options: CombinedFlightOptions) {
    if (options.providers.length === 0) {
      throw new AppError(
        'CONFIGURATION_ERROR',
        'A combined flight provider needs at least one source.',
      );
    }

    this.providers = options.providers;
    this.limiters = options.limiters;
    this.ceiling = options.ceiling ?? 4;
    this.rates = options.rates;
    this.onReport = options.onReport;

    this.metadata = {
      // Distinct from any single source, so a cache key never mixes a combined answer with one.
      id: options.providers.map((provider) => provider.metadata.id).join('+'),
      kind: 'flights',
      displayName: options.providers.map((provider) => provider.metadata.displayName).join(' + '),
      isMock: options.providers.every((provider) => provider.metadata.isMock),
      mode: weakestMode(options.providers),
      // Each source is limited by its own limiter at the leaf, so no second bound is declared
      // here: one would be a limit on the fan-out, which is the wrong place for it.
      rateLimitPerMinute: null,
    };
  }

  async checkHealth(options?: ProviderRequestOptions): Promise<ProviderHealth> {
    const healths = await Promise.all(
      this.providers.map((provider) => provider.checkHealth(options)),
    );
    const up = healths.filter((health) => health.status === 'healthy').length;

    return {
      status: up === healths.length ? 'healthy' : up > 0 ? 'degraded' : 'unavailable',
      checkedAt: healths[0]!.checkedAt,
      latencyMs: null,
      message: this.providers
        .map((provider, index) => `${provider.metadata.id}: ${healths[index]!.status}`)
        .join(', '),
    };
  }

  /** The merged offers with who reported each, and what every source did. */
  async searchDetailed(
    query: FlightSearchQuery,
    options?: ProviderRequestOptions,
  ): Promise<ProviderResult<CombinedSearch>> {
    const answers = await Promise.all(
      this.providers.map((provider) => this.ask(provider, query, options)),
    );

    const reports: SourceReport[] = answers.map((answer) => answer.report);
    const sources: FlightSource[] = answers.flatMap((answer) =>
      answer.offers ? [{ providerId: answer.report.providerId, offers: answer.offers }] : [],
    );

    if (sources.length === 0) {
      this.onReport?.({ sources: reports, dropped: [] });
      const causes = reports.map((report) => `${report.providerId}: ${report.error}`).join('; ');
      return err(new AppError('PROVIDER_UNAVAILABLE', `Every flight source failed (${causes}).`));
    }

    const combined = combineFlightOffers(sources, {
      currency: query.currency,
      ...(this.rates ? { rates: this.rates } : {}),
    });
    const report = { sources: reports, dropped: combined.dropped };
    this.onReport?.(report);

    return ok({ offers: combined.offers, report });
  }

  async searchFlights(
    query: FlightSearchQuery,
    options?: ProviderRequestOptions,
  ): Promise<ProviderResult<ProviderPage<FlightOffer>>> {
    const result = await this.searchDetailed(query, options);
    if (!result.ok) return err(result.error);

    return ok({
      items: result.value.offers
        .map((entry) => entry.offer)
        .slice(0, query.maxResults ?? result.value.offers.length),
      nextCursor: null,
    });
  }

  /** One source, under its own limiter, never throwing. */
  private async ask(
    provider: FlightProvider,
    query: FlightSearchQuery,
    options?: ProviderRequestOptions,
  ): Promise<{ report: SourceReport; offers: readonly FlightOffer[] | null }> {
    const { id, rateLimitPerMinute, typicalLatencyMs } = provider.metadata;
    const limiter = this.limiters.for(
      id,
      concurrencyFor(rateLimitPerMinute, this.ceiling, typicalLatencyMs ?? null),
    );

    try {
      // The leaf call and nothing around it: a slot is never held while waiting for another.
      const result = await limiter.run(() => provider.searchFlights(query, options));

      if (!result.ok) {
        log.warn({ provider: id, code: result.error.code }, 'flight source failed; degrading');
        return {
          report: { providerId: id, calls: 1, offers: 0, failures: 1, error: result.error.message },
          offers: null,
        };
      }

      return {
        report: {
          providerId: id,
          calls: 1,
          offers: result.value.items.length,
          failures: 0,
          error: null,
        },
        offers: result.value.items,
      };
    } catch (error) {
      // An adapter is meant to return a `Result`; one that throws is still only one source down.
      log.error({ provider: id, err: error }, 'flight source threw; degrading');
      return {
        report: {
          providerId: id,
          calls: 1,
          offers: 0,
          failures: 1,
          error: 'threw instead of returning',
        },
        offers: null,
      };
    }
  }
}
