/**
 * How many calls to a provider may be in flight at once.
 *
 * `ProviderMetadata.rateLimitPerMinute` has been declared on every adapter
 * since 1.1 and read by nothing - one of the mock-invisible assumptions the
 * live-provider readiness gate exists to settle. In-process mocks cost
 * nothing and never push back, so a bound chosen with no vendor in mind was
 * never tested by anything.
 */

/**
 * A semaphore is not a token bucket, and this does not pretend otherwise.
 *
 * A limiter bounds how many calls are *in flight*; a rate limit bounds how
 * many happen *per minute*. The two only meet through latency: `n` slots
 * issue about `n x 60 / seconds-per-call` calls a minute, so holding to `R`
 * per minute needs `n <= R x seconds-per-call / 60`.
 *
 * Taking one second as the floor for a real travel API call - a search
 * against a live flight vendor is rarely faster, and assuming faster is the
 * unsafe direction - gives `n = R / 60`. That is the number below.
 *
 * **What this does not do:** protect a provider whose calls return in
 * milliseconds. Nothing short of a token bucket can, and building one needs a
 * real vendor's numbers to be worth anything; 1.11 is where that lands. What
 * this does do is stop a fast provider spending a minute's allowance in a
 * few seconds, and stop a vendor that allows sixty calls a minute being hit
 * with six at once.
 */
export function concurrencyFor(rateLimitPerMinute: number | null, ceiling: number): number {
  if (!Number.isSafeInteger(ceiling) || ceiling < 1) {
    throw new RangeError(`concurrencyFor() requires a ceiling of at least 1, received ${ceiling}`);
  }

  /*
   * No stated limit means the search's own bound applies.
   *
   * Not "unlimited": a vendor that has not told us its rate limit has not
   * told us it is generous either. Every mock declares `null`, which is why
   * this keeps their behaviour exactly as it was.
   */
  if (rateLimitPerMinute === null) return ceiling;

  if (!Number.isFinite(rateLimitPerMinute) || rateLimitPerMinute < 1) {
    throw new RangeError(
      `concurrencyFor() requires a positive rate limit or null, received ${rateLimitPerMinute}`,
    );
  }

  // At least one, or the provider could never be called at all.
  return Math.max(1, Math.min(ceiling, Math.floor(rateLimitPerMinute / 60)));
}
