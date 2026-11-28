import { ageOf, checkedAgoLabel, FLIGHT_MAX_AGE_MS } from '@/core/freshness';
import type { FlightOffer, IsoDate, IsoDateTime } from '@/core/trip/types';
import { cacheKey, type CacheStore } from '@/cache';
import type { KiwiOffersKey, KiwiOffersRepository } from '@/db/repository';
import type { AppError } from '@/lib/errors';
import { getLogger } from '@/lib/logger';
import type { FlightProvider } from '../types';

/**
 * The 12-hour read path for a flight lookup.
 *
 * A price is refreshed only when it is older than 12 hours AND someone asked for it. Order:
 *
 *  1. the cache (Redis, else Postgres, else memory), younger than 12 h: return it;
 *  2. the durable Postgres row, younger than 12 h: warm the cache, return it;
 *  3. otherwise ONE call to the Kiwi adapter (guarded client). On success write both stores and
 *     return fresh;
 *  4. on failure, the newest stored value however old, labelled with its age. With nothing stored
 *     at all, an honest `no_data`. Never an empty page when stale data exists.
 *
 * The age that is judged and shown is the instant the MCP answered (`observedAt` inside the
 * stored value), never the instant a store happened to be written: warming the cache from a
 * 10-hour-old row must not make it look young. So the observation travels inside the cached value.
 *
 * Concurrent identical lookups share one MCP call: an in-process map always, and a cross-process
 * lock when one is supplied (Redis). A process that loses the lock waits for the winner's cache
 * write; it does not call the MCP itself.
 */

const log = getLogger('providers.kiwi-read-path');

export const KIWI_OFFERS_SCHEMA_VERSION = 1;

export interface KiwiLookup {
  readonly origin: string;
  readonly destination: string;
  readonly departureDate: IsoDate;
  readonly returnDate: IsoDate;
  readonly adults: number;
  readonly currency: string;
}

export type KiwiLookupSource = 'cache' | 'postgres' | 'mcp' | 'stale-cache' | 'stale-postgres';

export type KiwiLookupResult =
  | {
      readonly status: 'fresh' | 'stale';
      readonly offers: readonly FlightOffer[];
      readonly observedAt: IsoDateTime;
      readonly ageMs: number;
      /** "checked 14 h ago": what the page says instead of implying a live price. */
      readonly label: string;
      readonly source: KiwiLookupSource;
      /** Why the refresh failed, when this is a stale answer to a failed call. */
      readonly error: AppError | null;
    }
  | {
      readonly status: 'no_data';
      readonly offers: readonly [];
      readonly observedAt: null;
      readonly ageMs: null;
      readonly label: 'no data yet';
      readonly error: AppError | null;
    };

/** A lock across processes. `acquire` is true for exactly one holder. */
export interface LookupLock {
  acquire(key: string, ttlMs: number): Promise<boolean>;
  release(key: string): Promise<void>;
}

/** The slice of an ioredis client the lock uses. */
export interface RedisLockClient {
  set(key: string, value: string, mode: 'PX', ttlMs: number, flag: 'NX'): Promise<unknown>;
  del(key: string): Promise<unknown>;
}

/** A Redis `SET NX PX` lock. A broken Redis means "lock not held", so the caller proceeds alone. */
export function createRedisLookupLock(client: RedisLockClient): LookupLock {
  return {
    async acquire(key, ttlMs) {
      try {
        return (await client.set(`voyagr:lock:${key}`, '1', 'PX', ttlMs, 'NX')) === 'OK';
      } catch (error) {
        log.warn({ err: error }, 'lookup lock unavailable; continuing without it');
        return true;
      }
    },
    async release(key) {
      try {
        await client.del(`voyagr:lock:${key}`);
      } catch {
        // The lock expires on its own.
      }
    },
  };
}

/** What a real MCP answer produced. Fired only for a fresh call, never for a cache or row hit. */
export interface KiwiFreshObservation {
  readonly key: KiwiOffersKey;
  readonly offers: readonly FlightOffer[];
  readonly observedAt: IsoDateTime;
}

export interface KiwiReadPathOptions {
  /**
   * Called once after a fresh MCP answer is stored (the only moment a price is really observed).
   * Its failure never changes the lookup's answer.
   */
  readonly onFreshObservation?: (observation: KiwiFreshObservation) => Promise<void>;
  readonly provider: FlightProvider;
  readonly cache: CacheStore;
  readonly repository: KiwiOffersRepository;
  readonly lock?: LookupLock;
  readonly freshMs?: number;
  readonly now?: () => number;
  /** How long a process that lost the lock waits for the winner. */
  readonly lockWaitMs?: number;
  readonly lockPollMs?: number;
  readonly lockTtlMs?: number;
  readonly sleep?: (ms: number) => Promise<void>;
}

interface Stored {
  readonly offers: readonly FlightOffer[];
  readonly observedAt: IsoDateTime;
  readonly v: number;
}

function normalised(lookup: KiwiLookup): KiwiOffersKey {
  return {
    origin: lookup.origin.toUpperCase(),
    destination: lookup.destination.toUpperCase(),
    departureDate: lookup.departureDate,
    returnDate: lookup.returnDate,
    adults: lookup.adults,
    currency: lookup.currency.toUpperCase(),
  };
}

function isStored(value: unknown): value is Stored {
  const candidate = value as Partial<Stored> | null;
  return (
    typeof candidate === 'object' &&
    candidate !== null &&
    candidate.v === KIWI_OFFERS_SCHEMA_VERSION &&
    Array.isArray(candidate.offers) &&
    typeof candidate.observedAt === 'string' &&
    Number.isFinite(Date.parse(candidate.observedAt))
  );
}

export class KiwiReadPath {
  private readonly freshMs: number;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly inflight = new Map<string, Promise<KiwiLookupResult>>();

  constructor(private readonly options: KiwiReadPathOptions) {
    this.freshMs = options.freshMs ?? FLIGHT_MAX_AGE_MS;
    this.now = options.now ?? Date.now;
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  lookup(lookup: KiwiLookup): Promise<KiwiLookupResult> {
    const key = normalised(lookup);
    const id = cacheKey('kiwi-flights', key);

    const existing = this.inflight.get(id);
    if (existing) return existing;

    const running = this.resolve(key, id).finally(() => this.inflight.delete(id));
    this.inflight.set(id, running);
    return running;
  }

  private isFresh(stored: Stored): boolean {
    const age = ageOf(stored.observedAt, this.now());
    // An observation dated in the future is not believed, so it is not fresh.
    return age !== null && age >= -60_000 && age <= this.freshMs;
  }

  private answer(
    stored: Stored,
    source: KiwiLookupSource,
    error: AppError | null,
  ): KiwiLookupResult {
    const ageMs = Math.max(0, ageOf(stored.observedAt, this.now()) ?? 0);
    return {
      status: this.isFresh(stored) ? 'fresh' : 'stale',
      offers: stored.offers,
      observedAt: stored.observedAt,
      ageMs,
      label: checkedAgoLabel(ageMs),
      source,
      error,
    };
  }

  private async readCache(id: string): Promise<Stored | null> {
    try {
      const entry = await this.options.cache.get<Stored>(id);
      return entry && isStored(entry.value) ? entry.value : null;
    } catch (error) {
      log.warn({ err: error }, 'cache read failed; treating as a miss');
      return null;
    }
  }

  private async readRow(key: KiwiOffersKey): Promise<Stored | null> {
    try {
      const row = await this.options.repository.get(key);
      if (!row) return null;
      const stored = { offers: row.offers, observedAt: row.observedAt, v: row.schemaVersion };
      return isStored(stored) ? stored : null;
    } catch (error) {
      log.warn({ err: error }, 'offers read failed; treating as a miss');
      return null;
    }
  }

  private async writeCache(id: string, stored: Stored): Promise<void> {
    // The entry may live only as long as the value is fresh.
    const remaining = this.freshMs - (ageOf(stored.observedAt, this.now()) ?? 0);
    if (remaining <= 0) return;
    try {
      await this.options.cache.set(id, stored, { ttlMs: remaining });
    } catch (error) {
      log.warn({ err: error }, 'cache write failed; the value is still returned');
    }
  }

  private async resolve(key: KiwiOffersKey, id: string): Promise<KiwiLookupResult> {
    const cached = await this.readCache(id);
    if (cached && this.isFresh(cached)) return this.answer(cached, 'cache', null);

    const row = await this.readRow(key);
    if (row && this.isFresh(row)) {
      await this.writeCache(id, row);
      return this.answer(row, 'postgres', null);
    }

    const lock = this.options.lock;
    if (lock && !(await lock.acquire(id, this.options.lockTtlMs ?? 30_000))) {
      const winner = await this.waitForWinner(id);
      if (winner) return this.answer(winner, 'cache', null);
      return this.fallback(cached, row, null);
    }

    try {
      return await this.fetch(key, id, cached, row);
    } finally {
      if (lock) await lock.release(id);
    }
  }

  private async waitForWinner(id: string): Promise<Stored | null> {
    const deadline = this.now() + (this.options.lockWaitMs ?? 6_000);
    const poll = this.options.lockPollMs ?? 200;
    while (this.now() < deadline) {
      await this.sleep(poll);
      const found = await this.readCache(id);
      if (found && this.isFresh(found)) return found;
    }
    return null;
  }

  private async fetch(
    key: KiwiOffersKey,
    id: string,
    cached: Stored | null,
    row: Stored | null,
  ): Promise<KiwiLookupResult> {
    const called = await this.options.provider.searchFlights({
      origins: [key.origin],
      destinations: [key.destination],
      departureDate: key.departureDate,
      returnDate: key.returnDate,
      passengers: key.adults,
      currency: key.currency,
    });

    if (!called.ok) {
      log.warn({ code: called.error.code }, 'kiwi lookup failed; serving stored value if any');
      return this.fallback(cached, row, called.error);
    }

    const stored: Stored = {
      offers: called.value.items,
      observedAt: new Date(this.now()).toISOString(),
      v: KIWI_OFFERS_SCHEMA_VERSION,
    };
    await this.writeCache(id, stored);
    try {
      await this.options.repository.put({
        ...key,
        schemaVersion: stored.v,
        offers: stored.offers,
        observedAt: stored.observedAt,
      });
    } catch (error) {
      log.warn({ err: error }, 'offers write failed; the value is still returned');
    }
    if (this.options.onFreshObservation) {
      try {
        await this.options.onFreshObservation({
          key,
          offers: stored.offers,
          observedAt: stored.observedAt,
        });
      } catch (error) {
        log.warn({ err: error }, 'price observation failed; the lookup is unaffected');
      }
    }
    return this.answer(stored, 'mcp', null);
  }

  private fallback(
    cached: Stored | null,
    row: Stored | null,
    error: AppError | null,
  ): KiwiLookupResult {
    const candidates: { stored: Stored; source: KiwiLookupSource }[] = [];
    if (cached) candidates.push({ stored: cached, source: 'stale-cache' });
    if (row) candidates.push({ stored: row, source: 'stale-postgres' });
    candidates.sort((a, b) => Date.parse(b.stored.observedAt) - Date.parse(a.stored.observedAt));

    const newest = candidates[0];
    if (newest) return this.answer(newest.stored, newest.source, error);
    return {
      status: 'no_data',
      offers: [],
      observedAt: null,
      ageMs: null,
      label: 'no data yet',
      error,
    };
  }
}
