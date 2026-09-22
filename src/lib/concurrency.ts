/**
 * Bounded concurrency for provider calls.
 *
 * A trip search fans out across origins, destinations and date windows, so a
 * single user request becomes dozens of provider calls. Firing them all at once
 * would breach provider rate limits and turn one impatient user into an outage.
 *
 * The bound is a *shared* object rather than a number passed to each fan-out,
 * and that is the whole point. A number has to be re-applied correctly at every
 * level of nesting, and a nested fan-out that passes the same number twice
 * silently permits its square. One limiter threaded through every call site
 * holds the limit no matter how the code around it is later restructured.
 *
 * **A task must never hold a slot while waiting for another one.** Wrap the leaf
 * call - the single request - and never the fan-out around it. Holding a slot
 * while queueing for the next deadlocks the moment every slot is held by a task
 * that is itself waiting, which is why `callProvider` is the only place in the
 * search that acquires one.
 */

export interface Limiter {
  /** Maximum tasks allowed to run at once. */
  readonly limit: number;
  readonly inFlight: number;
  /**
   * Highest number of tasks observed running at once.
   *
   * Reported in search diagnostics and asserted in tests: a bound nobody can
   * observe is a bound nobody can prove.
   */
  readonly peakInFlight: number;
  /** Run `task` once a slot is free. Rejections propagate and free the slot. */
  run<T>(task: () => Promise<T>): Promise<T>;
}

export function createLimiter(limit: number): Limiter {
  if (!Number.isSafeInteger(limit) || limit < 1) {
    throw new RangeError(`createLimiter() requires a limit of at least 1, received ${limit}`);
  }

  let inFlight = 0;
  let peak = 0;
  const waiting: Array<() => void> = [];

  /**
   * Hand the slot straight to the next waiter rather than releasing it.
   *
   * Decrementing first would open a window - `inFlight` is briefly below the
   * limit while the woken task has not yet resumed - through which a new caller
   * could take a slot that is already spoken for, putting `limit + 1` tasks in
   * flight.
   */
  function release(): void {
    const next = waiting.shift();
    if (next) next();
    else inFlight -= 1;
  }

  return {
    limit,
    get inFlight() {
      return inFlight;
    },
    get peakInFlight() {
      return peak;
    },
    async run<T>(task: () => Promise<T>): Promise<T> {
      if (inFlight >= limit) {
        // The slot is granted by `release`, which has already counted it.
        await new Promise<void>((resolve) => waiting.push(resolve));
      } else {
        inFlight += 1;
      }

      if (inFlight > peak) peak = inFlight;

      try {
        return await task();
      } finally {
        release();
      }
    },
  };
}

/**
 * One limiter per provider, made on first use.
 *
 * A rate limit belongs to a vendor, not to a search. One limiter shared by
 * every provider meant a slow hotel vendor throttled the flight calls queued
 * behind it, while two vendors that each allow plenty were held to a budget
 * sized for neither. Splitting the bound per provider is what the
 * live-provider readiness gate asks for, and it is the shape a rate limit
 * actually has.
 *
 * **The rule that has not changed:** within one provider there is still
 * exactly one limiter for the whole search, still acquired around the leaf
 * call and never around the fan-out. A pool hands out a shared object per
 * key; it does not hand out a fresh bound per call site, which would be the
 * multiplying-nested-bounds mistake wearing a new hat.
 */
export interface LimiterPool {
  /**
   * The limiter for one key, created with `limit` if it does not exist yet.
   *
   * The limit is fixed by whoever asks first. A later caller asking for a
   * different one gets the existing limiter, because a bound that can be
   * raised by a second caller is not a bound.
   */
  for(key: string, limit?: number): Limiter;
  /** Every limiter handed out so far, for diagnostics and tests. */
  readonly limiters: ReadonlyMap<string, Limiter>;
}

export function createLimiterPool(fallbackLimit: number): LimiterPool {
  const limiters = new Map<string, Limiter>();

  return {
    limiters,
    for(key: string, limit = fallbackLimit): Limiter {
      const existing = limiters.get(key);
      if (existing) return existing;

      const created = createLimiter(limit);
      limiters.set(key, created);

      return created;
    },
  };
}
