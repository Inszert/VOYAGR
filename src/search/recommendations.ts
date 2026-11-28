import { ageOf, checkedAgoLabel, FLIGHT_MAX_AGE_MS } from '@/core/freshness';
import { buildRecommendationItems } from '@/core/recommendations/build';
import type { FlightOffer, IsoDate, IsoDateTime } from '@/core/trip/types';
import type {
  KiwiOffersRepository,
  RecommendationItem,
  RecommendationListKey,
  RecommendationListRepository,
  RouteGraphEdge,
  RouteGraphRepository,
} from '@/db/repository';
import { getLogger } from '@/lib/logger';
import type { McpClient } from '@/providers/mcp/client';
import { mapReturnItinerary, parseSearchFlight, toKiwiDate } from '@/providers/flights/kiwi-mcp';
import { KIWI_OFFERS_SCHEMA_VERSION } from '@/providers/flights/kiwi-read-path';

/**
 * Lazy recommendations.
 *
 * A list per origin and date window is generated only when someone asked for it (the app is open)
 * AND the stored list is older than 12 hours or missing. A younger list is served and the MCP is
 * not called at all. Generation is ONE `search-flight` call: `flyTo: "anywhere"` with
 * `one_for_city`, so the server returns the cheapest return per destination city. A failure, an
 * open circuit or an exhausted call budget keeps the stored list and labels its age.
 *
 * The prices and order come from `src/core/recommendations/build.ts`; the model has no part here.
 */

const log = getLogger('search.recommendations');

/** Calls this feature may make per UTC day, on top of the MCP client's own global budget. */
export const RECOMMENDATION_DAILY_CALLS = 20;

export interface CallBudget {
  /** True and counted when a call may be made; false when the day's allowance is spent. */
  tryTake(): boolean;
}

export function createDailyCallBudget(limit: number, now: () => number = Date.now): CallBudget {
  let day = '';
  let used = 0;
  return {
    tryTake() {
      const today = new Date(now()).toISOString().slice(0, 10);
      if (today !== day) {
        day = today;
        used = 0;
      }
      if (used >= limit) return false;
      used += 1;
      return true;
    },
  };
}

export interface RecommendationRequest {
  readonly origin: string;
  readonly from: IsoDate;
  readonly to: IsoDate;
  readonly minNights: number;
  readonly maxNights: number;
  readonly adults: number;
  readonly currency: string;
}

export type RecommendationStatus = 'fresh' | 'stale' | 'missing';

export interface RecommendationView {
  readonly status: RecommendationStatus;
  readonly items: readonly RecommendationItem[];
  readonly generatedAt: IsoDateTime | null;
  /** "checked 14 h ago", or "no data yet". */
  readonly label: string;
  /** True when this call asked the MCP and it answered. */
  readonly refreshed: boolean;
  /** Why a needed refresh did not happen. */
  readonly refreshFailed: 'budget' | 'error' | null;
}

export interface RecommendationServiceOptions {
  readonly client: McpClient;
  readonly lists: RecommendationListRepository;
  readonly offers: KiwiOffersRepository;
  readonly routeGraph: RouteGraphRepository;
  readonly budget: CallBudget;
  readonly freshMs?: number;
  readonly now?: () => number;
}

export function keyOf(request: RecommendationRequest): RecommendationListKey {
  return {
    origin: request.origin.toUpperCase(),
    window: `${request.from}..${request.to}`,
    adults: request.adults,
    currency: request.currency.toUpperCase(),
  };
}

export class RecommendationService {
  private readonly freshMs: number;
  private readonly now: () => number;
  private readonly inflight = new Map<string, Promise<RecommendationView>>();

  constructor(private readonly options: RecommendationServiceOptions) {
    this.freshMs = options.freshMs ?? FLIGHT_MAX_AGE_MS;
    this.now = options.now ?? Date.now;
  }

  /** What is stored, whatever its age. Never calls the MCP: this is what the page shows first. */
  async peek(request: RecommendationRequest): Promise<RecommendationView> {
    const row = await this.options.lists.get(keyOf(request));
    return this.view(row ? row.items : null, row ? row.generatedAt : null, false, null);
  }

  /** Serve the stored list if it is under 12 h old; otherwise refresh it once. */
  ensure(request: RecommendationRequest): Promise<RecommendationView> {
    const key = keyOf(request);
    const id = `${key.origin}|${key.window}|${key.adults}|${key.currency}`;
    const running = this.inflight.get(id);
    if (running) return running;
    const next = this.resolve(request).finally(() => this.inflight.delete(id));
    this.inflight.set(id, next);
    return next;
  }

  private view(
    items: readonly RecommendationItem[] | null,
    generatedAt: IsoDateTime | null,
    refreshed: boolean,
    refreshFailed: RecommendationView['refreshFailed'],
  ): RecommendationView {
    if (!items || !generatedAt) {
      return {
        status: 'missing',
        items: [],
        generatedAt: null,
        label: 'no data yet',
        refreshed,
        refreshFailed,
      };
    }
    const age = ageOf(generatedAt, this.now());
    const fresh = age !== null && age >= -60_000 && age <= this.freshMs;
    return {
      status: fresh ? 'fresh' : 'stale',
      items,
      generatedAt,
      label: checkedAgoLabel(age === null ? null : Math.max(0, age)),
      refreshed,
      refreshFailed,
    };
  }

  private async resolve(request: RecommendationRequest): Promise<RecommendationView> {
    const key = keyOf(request);
    const stored = await this.options.lists.get(key);
    const current = this.view(stored?.items ?? null, stored?.generatedAt ?? null, false, null);
    if (current.status === 'fresh') return current;

    if (!this.options.budget.tryTake()) {
      log.info('recommendation refresh skipped: daily call budget spent');
      return { ...current, refreshFailed: 'budget' };
    }

    const generated = await this.generate(request, key);
    if (!generated) return { ...current, refreshFailed: 'error' };
    return this.view(generated.items, generated.generatedAt, true, null);
  }

  private async generate(
    request: RecommendationRequest,
    key: RecommendationListKey,
  ): Promise<{ items: RecommendationItem[]; generatedAt: IsoDateTime } | null> {
    const called = await this.options.client.callTool('search-flight', {
      flyFrom: key.origin,
      flyTo: 'anywhere',
      departureDate: toKiwiDate(request.from),
      departureDateTo: toKiwiDate(request.to),
      nights_in_dst_from: request.minNights,
      nights_in_dst_to: request.maxNights,
      one_for_city: true,
      adults: request.adults,
      currency: key.currency,
      sort: 'price',
    });
    if (!called.ok) {
      log.warn({ code: called.error.code }, 'recommendation generation failed; keeping list');
      return null;
    }

    const generatedAt = new Date(this.now()).toISOString();
    const parsed = parseSearchFlight(called.value.text, generatedAt, mapReturnItinerary);
    if ('failed' in parsed) {
      log.warn({ reason: parsed.failed }, 'recommendation answer not usable');
      return null;
    }

    const offers: FlightOffer[] = parsed.items;
    const items = buildRecommendationItems(offers, key.currency);
    // An answer with no usable destination must not replace a good list with an empty one.
    if (items.length === 0) return null;

    await this.persist(key, offers, items, generatedAt);
    return { items, generatedAt };
  }

  private async persist(
    key: RecommendationListKey,
    offers: readonly FlightOffer[],
    items: readonly RecommendationItem[],
    generatedAt: IsoDateTime,
  ): Promise<void> {
    try {
      await this.options.lists.put({ ...key, items, generatedAt });
    } catch (error) {
      log.warn({ err: error }, 'recommendation list write failed; the list is still returned');
    }

    try {
      const edges: RouteGraphEdge[] = [];
      for (const item of items) {
        const offer = offers.find(
          (o) =>
            o.price.amount === item.priceMinor &&
            o.outbound.segments[o.outbound.segments.length - 1]?.destination === item.destination,
        );
        if (!offer) continue;
        await this.options.offers.put({
          origin: key.origin,
          destination: item.destination,
          departureDate: item.departureDate,
          returnDate: item.returnDate,
          adults: key.adults,
          currency: key.currency,
          schemaVersion: KIWI_OFFERS_SCHEMA_VERSION,
          offers: [offer],
          observedAt: generatedAt,
        });
        // Only a nonstop proves the carrier flies this pair.
        if (offer.outbound.segments.length === 1 && item.carrier) {
          edges.push({
            origin: key.origin,
            destination: item.destination,
            carrier: item.carrier,
            firstSeenAt: generatedAt,
            lastSeenAt: generatedAt,
          });
        }
      }
      if (edges.length > 0) await this.options.routeGraph.upsertEdges(edges);
    } catch (error) {
      log.warn({ err: error }, 'route storage write failed; the list is still returned');
    }
  }
}
