/**
 * Deterministic pseudo-randomness for mock providers.
 *
 * Mock adapters must be *varied* but not *random*: the same query has to return
 * the same offers on every run, or tests become flaky and price-history diffs
 * become meaningless. Every mock derives its numbers from a hash of the query
 * rather than from `Math.random()`.
 */

/** FNV-1a, 32-bit. Small, fast and stable across runs and platforms. */
export function hashString(input: string): number {
  let hash = 0x811c9dc5;

  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    // Multiply by the FNV prime (16777619) using shifts to stay in 32-bit range.
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }

  return hash >>> 0;
}

/** mulberry32: a compact, well-distributed seeded generator. */
export function createRandom(seed: number): () => number {
  let state = seed >>> 0;

  return function next(): number {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface DeterministicSource {
  /** Float in [0, 1). */
  next(): number;
  /** Integer in [min, max], inclusive. */
  int(min: number, max: number): number;
  /** Float in [min, max). */
  float(min: number, max: number): number;
  /** Pick one element. Throws on an empty list, which is always a bug. */
  pick<T>(items: readonly T[]): T;
  /** True with the given probability. */
  chance(probability: number): boolean;
}

export function deterministicSource(seedInput: string): DeterministicSource {
  const random = createRandom(hashString(seedInput));

  return {
    next: random,
    int(min, max) {
      return Math.floor(random() * (max - min + 1)) + min;
    },
    float(min, max) {
      return random() * (max - min) + min;
    },
    pick<T>(items: readonly T[]): T {
      const item = items[Math.floor(random() * items.length)];
      if (item === undefined) {
        throw new Error('deterministicSource.pick() called with an empty list');
      }
      return item;
    },
    chance(probability) {
      return random() < probability;
    },
  };
}

/** Add whole days to an ISO calendar date without timezone drift. */
export function addDays(isoDate: string, days: number): string {
  const [year, month, day] = isoDate.split('-').map(Number);

  if (year === undefined || month === undefined || day === undefined) {
    throw new TypeError(`Invalid ISO date: ${JSON.stringify(isoDate)}`);
  }

  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);

  return date.toISOString().slice(0, 10);
}

/** Whole nights between two ISO calendar dates. */
export function nightsBetween(checkIn: string, checkOut: string): number {
  const start = Date.parse(`${checkIn}T00:00:00Z`);
  const end = Date.parse(`${checkOut}T00:00:00Z`);

  if (Number.isNaN(start) || Number.isNaN(end)) {
    throw new TypeError(`Invalid date range: ${checkIn} to ${checkOut}`);
  }

  return Math.round((end - start) / 86_400_000);
}

/** Compose an ISO timestamp from a calendar date and a local hour/minute. */
export function atTime(isoDate: string, hour: number, minute: number): string {
  const hh = String(hour).padStart(2, '0');
  const mm = String(minute).padStart(2, '0');
  return `${isoDate}T${hh}:${mm}:00Z`;
}

/**
 * A fixed observation timestamp for mock data.
 *
 * Mocks must not embed `new Date()`, or every snapshot differs from the last.
 * Real adapters record the true observation time.
 */
export const MOCK_OBSERVED_AT = '2026-01-15T09:00:00Z';
