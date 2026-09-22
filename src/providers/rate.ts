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
 * One second is the floor when nobody has measured the vendor - a search
 * against a live flight vendor is rarely faster, and assuming faster is the
 * unsafe direction - which gives `n = R / 60`.
 *
 * When an adapter *has* measured itself, `typicalLatencyMs` replaces the
 * floor, and the same inequality does something better than throttle: Duffel
 * allows thirty calls a minute and takes about four and a half seconds to
 * answer, so `30 x 4.5 / 60` is two in flight rather than the one the flat
 * floor allowed. The quota is still respected - two calls of four and a half
 * seconds is twenty-six a minute - and the search stops being half as fast as
 * the vendor permits.
 *
 * **What this does not do:** protect a provider whose calls return in
 * milliseconds. Nothing short of a token bucket can, and building one needs a
 * real vendor's numbers to be worth anything; 1.11 is where that lands. What
 * this does do is stop a fast provider spending a minute's allowance in a
 * few seconds, and stop a vendor that allows sixty calls a minute being hit
 * with six at once.
 */
export const ASSUMED_CALL_MS = 1_000;

export function concurrencyFor(
  rateLimitPerMinute: number | null,
  ceiling: number,
  typicalLatencyMs: number | null = null,
): number {
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

  const seconds = callSeconds(typicalLatencyMs);

  // At least one, or the provider could never be called at all.
  return Math.max(1, Math.min(ceiling, Math.floor((rateLimitPerMinute * seconds) / 60)));
}

/** A call's duration in seconds: what was measured, or the assumed floor. */
function callSeconds(typicalLatencyMs: number | null): number {
  if (typicalLatencyMs === null || typicalLatencyMs === undefined) return ASSUMED_CALL_MS / 1000;

  if (!Number.isFinite(typicalLatencyMs) || typicalLatencyMs <= 0) {
    throw new RangeError(
      `concurrencyFor() requires a positive latency or null, received ${typicalLatencyMs}`,
    );
  }

  return typicalLatencyMs / 1000;
}

/**
 * How many calls a provider can actually serve inside a wall-clock budget.
 *
 * The companion to `concurrencyFor`, and the reason the measurement is worth
 * having twice. A limiter decides how many calls run at once; this decides
 * how many there should be in the first place, because a fan-out planned for
 * mocks is a fan-out planned against a provider that costs nothing.
 *
 * Eight date windows is eight flight calls. Against an in-process mock that
 * is instant; against a vendor answering in four and a half seconds, two at
 * a time, it is eighteen seconds of somebody watching a spinner. This returns
 * the number of calls that fit instead - and the caller then prices *those*
 * dates rather than pretending it looked at the rest.
 *
 * Never returns zero: a search that can afford no calls is not a faster
 * search, it is a broken one.
 */
export function callsWithin(
  timeBudgetMs: number,
  concurrency: number,
  typicalLatencyMs: number | null,
): number {
  if (!Number.isFinite(timeBudgetMs) || timeBudgetMs <= 0) {
    throw new RangeError(`callsWithin() requires a positive time budget, received ${timeBudgetMs}`);
  }

  if (!Number.isSafeInteger(concurrency) || concurrency < 1) {
    throw new RangeError(
      `callsWithin() requires a concurrency of at least 1, received ${concurrency}`,
    );
  }

  const perCallMs = callSeconds(typicalLatencyMs) * 1000;

  // Rounds of `concurrency` calls, each taking one call's time.
  return Math.max(1, Math.floor(timeBudgetMs / perCallMs) * concurrency);
}
