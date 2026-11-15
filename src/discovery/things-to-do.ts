import { cacheKey, getCacheStore, readThrough, type CacheStore } from '@/cache';
import { createLimiterPool, type LimiterPool } from '@/lib/concurrency';
import { getLogger } from '@/lib/logger';
import { isOk } from '@/lib/result';
import type { ImageCredit } from '@/providers/imagery/types';
import { fetchCommonsCredits } from '@/providers/places/commons';
import { concurrencyFor } from '@/providers/rate';
import { getProviderRegistry } from '@/providers/registry';
import {
  THING_KINDS,
  type PlacesProvider,
  type ThingKind,
  type ThingToDo,
} from '@/providers/types';

/**
 * A destination's things to do: what the page shows, and how it is fetched.
 *
 * The list is real or it is absent. The provider names real places from an open
 * dataset; nothing here adds one, reorders one by opinion, or fills a gap. A
 * provider that is switched off, down, or empty yields a status the page turns
 * into its honest "cannot tell you yet" note - never a made-up list.
 *
 * Cached for a week and served stale for a month more (`places` kind): what a
 * city has worth visiting changes slowly, and the source is a free service that
 * asks to be asked rarely and one query at a time.
 */

const log = getLogger('discovery.things-to-do');

export const THINGS_FRESH_MS = 7 * 24 * 60 * 60 * 1000;
export const THINGS_STALE_MS = 30 * 24 * 60 * 60 * 1000;

/** The most a reader is shown at once. "Up to 30" - fewer real places is fine. */
export const MAX_THINGS_SHOWN = 30;

/** How many the provider is asked for, so each group can still fill after a filter. */
const FETCH_LIMIT = 60;

export const KIND_LABELS: Readonly<Record<ThingKind, string>> = {
  sights: 'Sights',
  museums: 'Museums',
  outdoors: 'Outdoors',
  neighbourhoods: 'Neighbourhoods',
  food: 'Food & markets',
  culture: 'Culture',
};

export function parseKind(value: string | string[] | undefined): ThingKind | null {
  const single = Array.isArray(value) ? value[0] : value;

  return THING_KINDS.find((kind) => kind === single) ?? null;
}

/** The places for one filter, best known first, and no more than the page shows. */
export function placesToShow(
  things: readonly ThingToDo[],
  kind: ThingKind | null,
  limit = MAX_THINGS_SHOWN,
): ThingToDo[] {
  return things.filter((thing) => kind === null || thing.kind === kind).slice(0, limit);
}

/** How many of the places the page would show fall in each group, for the filter chips. */
export function countsByKind(things: readonly ThingToDo[]): Record<ThingKind, number> {
  const counts = Object.fromEntries(THING_KINDS.map((kind) => [kind, 0])) as Record<
    ThingKind,
    number
  >;
  for (const thing of things.slice(0, FETCH_LIMIT)) counts[thing.kind] += 1;

  return counts;
}

export type ThingsToDoOutcome =
  /** No data source behind the slot. */
  | { readonly status: 'absent' }
  /** The source did not answer and nothing was cached. */
  | { readonly status: 'unavailable' }
  | {
      readonly status: 'ok';
      readonly things: readonly ThingToDo[];
      /** By Commons file name. A picture with no entry is credited by its file page. */
      readonly credits: Readonly<Record<string, ImageCredit>>;
      /** True when the places are fixtures, so the page can say they are samples. */
      readonly sample: boolean;
      readonly ageMs: number | null;
    };

declare global {
  var __voyagrPlacesLimiters: LimiterPool | undefined;
}

/** One limiter per provider for the whole process, sized from what the vendor declares. */
function limiters(): LimiterPool {
  globalThis.__voyagrPlacesLimiters ??= createLimiterPool(1);
  return globalThis.__voyagrPlacesLimiters;
}

export interface ThingsToDoRequest {
  readonly destination: string;
  readonly destinationName: string;
  /** `[longitude, latitude]` as the product holds the destination. */
  readonly position: readonly [number, number];
  /** Injectable for tests; defaults to the registry's places provider. */
  readonly provider?: PlacesProvider;
  readonly store?: CacheStore;
  readonly fetchCredits?: typeof fetchCommonsCredits;
}

/** Never throws: every failure ends as a status the page can word. */
export async function loadThingsToDo(request: ThingsToDoRequest): Promise<ThingsToDoOutcome> {
  const provider = request.provider ?? getProviderRegistry().places;
  if (provider.metadata.mode === 'absent') return { status: 'absent' };

  const store = request.store ?? getCacheStore();
  const limiter = limiters().for(
    provider.metadata.id,
    concurrencyFor(
      provider.metadata.rateLimitPerMinute,
      1,
      provider.metadata.typicalLatencyMs ?? null,
    ),
  );

  try {
    const cached = await readThrough(
      store,
      cacheKey('places', {
        provider: provider.metadata.id,
        destination: request.destination,
        position: request.position,
      }),
      {
        freshMs: THINGS_FRESH_MS,
        staleMs: THINGS_STALE_MS,
        // A failed load is thrown out of the loader so it is never cached as an answer.
        load: async () => {
          // The leaf call, and only the leaf call, holds the slot.
          const result = await limiter.run(() =>
            provider.thingsToDo({
              destination: request.destination,
              destinationName: request.destinationName,
              position: request.position,
              maxResults: FETCH_LIMIT,
            }),
          );
          if (!isOk(result)) throw result.error;

          return result.value;
        },
      },
    );

    if (cached.value === null) {
      log.warn(
        { destination: request.destination, error: cached.error },
        'things to do unavailable',
      );
      return { status: 'unavailable' };
    }

    const things = cached.value;
    return {
      status: 'ok',
      things,
      credits: await creditsFor(things, store, request.fetchCredits ?? fetchCommonsCredits),
      sample: provider.metadata.isMock,
      ageMs: cached.ageMs,
    };
  } catch (cause) {
    log.warn({ err: cause, destination: request.destination }, 'things to do failed');
    return { status: 'unavailable' };
  }
}

/** Who took each picture. A failed lookup is an empty answer: the pictures name their file page. */
async function creditsFor(
  things: readonly ThingToDo[],
  store: CacheStore,
  fetchCredits: typeof fetchCommonsCredits,
): Promise<Record<string, ImageCredit>> {
  const files = [
    ...new Set(things.flatMap((thing) => (thing.imageFile ? [thing.imageFile] : []))),
  ].sort();
  if (files.length === 0) return {};

  const cached = await readThrough(store, cacheKey('places', { credits: files }), {
    freshMs: THINGS_FRESH_MS,
    staleMs: THINGS_STALE_MS,
    load: async () => {
      const result = await fetchCredits(files, { signal: AbortSignal.timeout(15_000) });
      if (!isOk(result)) throw result.error;

      return Object.fromEntries(result.value);
    },
  });

  return cached.value ?? {};
}
