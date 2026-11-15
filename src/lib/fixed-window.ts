/**
 * A fixed-window request counter.
 *
 * The smallest thing that bounds how often something may happen: `max` takes
 * per `windowMs` per key. Pure apart from an injectable clock, in-process and
 * therefore per-instance (the same stated limitation as the sign-in throttle).
 *
 * Memory is bounded as well as rate: a key an attacker chooses (an address, a
 * query) must not be able to grow the map forever, so once it passes `maxKeys`
 * the expired windows are dropped, and if that is not enough the oldest go.
 */

export interface WindowDecision {
  readonly allowed: boolean;
  /** Seconds until the window turns over. Zero when allowed. */
  readonly retryAfterSeconds: number;
}

export interface FixedWindowOptions {
  readonly max: number;
  readonly windowMs: number;
  readonly maxKeys?: number;
  readonly now?: () => number;
}

interface Window {
  count: number;
  startedAt: number;
}

export class FixedWindowLimiter {
  private readonly max: number;
  private readonly windowMs: number;
  private readonly maxKeys: number;
  private readonly now: () => number;
  private readonly windows = new Map<string, Window>();

  constructor(options: FixedWindowOptions) {
    this.max = options.max;
    this.windowMs = options.windowMs;
    this.maxKeys = options.maxKeys ?? 10_000;
    this.now = options.now ?? Date.now;
  }

  /** Count one event against `key`. A refused event is not recorded, so it never extends the wait. */
  take(key: string): WindowDecision {
    const now = this.now();
    const window = this.windows.get(key);

    if (!window || now - window.startedAt >= this.windowMs) {
      if (!window && this.windows.size >= this.maxKeys) this.evict(now);
      this.windows.set(key, { count: 1, startedAt: now });
      return { allowed: true, retryAfterSeconds: 0 };
    }

    if (window.count >= this.max) {
      return {
        allowed: false,
        retryAfterSeconds: Math.max(1, Math.ceil((window.startedAt + this.windowMs - now) / 1000)),
      };
    }

    window.count += 1;
    return { allowed: true, retryAfterSeconds: 0 };
  }

  private evict(now: number): void {
    for (const [key, window] of this.windows) {
      if (now - window.startedAt >= this.windowMs) this.windows.delete(key);
    }

    // Still full of live windows: drop the oldest (Map keeps insertion order).
    // Forgetting a client's count is the safe direction; refusing everyone is not.
    while (this.windows.size >= this.maxKeys) {
      const oldest = this.windows.keys().next().value;
      if (oldest === undefined) break;
      this.windows.delete(oldest);
    }
  }

  get size(): number {
    return this.windows.size;
  }
}
