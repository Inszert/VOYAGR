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
