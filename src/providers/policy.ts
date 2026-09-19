import type { ProviderMetadata } from './types';

/**
 * Per-operation provider policy.
 *
 * Written from what the live-provider research actually found, not from
 * assumptions (see `docs/provider-evaluation.md`). Three findings are encoded
 * here because each of them breaks something the code previously took for
 * granted:
 *
 *  - **A failed call is not simply a failed call.** Duffel documents responses
 *    that must not be retried, and says a 202 on order creation "may result in
 *    a duplicate order or booking". A blanket retry at the provider boundary
 *    would create duplicate bookings, which is the most expensive bug this
 *    product could ship.
 *  - **One timeout does not fit every operation.** Duffel requires a client
 *    timeout of at least 130 seconds for order creation, because airline
 *    systems can take 120. Our search timeout is eight seconds. Both are
 *    right, for different operations.
 *  - **Limits are per provider, not per product.** A cited Hotelbeds plan
 *    allows 4 queries per second; Duffel's documented search limit is 120 per
 *    minute. One number cannot serve both.
 */

/**
 * What a call is trying to do.
 *
 * Not which endpoint it hits: what it would cost to do twice. That is the only
 * distinction retry policy cares about.
 */
export type ProviderOperation =
  /** Read-only. Safe to repeat; the worst case is a wasted call. */
  | 'search'
  /** Read-only, but priced per call by some vendors and usually latency-bound. */
  | 'price-check'
  /** Creates something. Repeating it can create it twice. */
  | 'create-order'
  /** Cheap liveness probe that must never consume search quota. */
  | 'health';

export type RetryStance =
  /** Repeat on a transient failure. */
  | 'on-transient'
  /**
   * Never repeat automatically, whatever the response said.
   *
   * For anything that creates or changes state. A timeout on order creation
   * does not mean the order was not created - it means we do not know, and
   * retrying turns "do not know" into "definitely two".
   */
  | 'never';

export interface OperationPolicy {
  readonly stance: RetryStance;
  /** Including the first. `1` means no retry at all. */
  readonly maxAttempts: number;
  readonly timeoutMs: number;
  /** Statuses worth repeating. A 4xx other than 429 is our bug, not theirs. */
  readonly retryableStatuses: readonly number[];
}

/** Transient by nature: the same request may well succeed shortly. */
const TRANSIENT_STATUSES = [429, 500, 502, 503, 504] as const;

/**
 * Defaults per operation.
 *
 * Deliberately values in one table rather than numbers scattered through
 * adapters, so changing the product's patience is an edit to one object that
 * every test reads from.
 */
export const DEFAULT_OPERATION_POLICIES: Record<ProviderOperation, OperationPolicy> = {
  search: {
    stance: 'on-transient',
    maxAttempts: 3,
    timeoutMs: 8_000,
    retryableStatuses: TRANSIENT_STATUSES,
  },
  'price-check': {
    // Read-only, so safe to repeat, but slower and often billed per call.
    stance: 'on-transient',
    maxAttempts: 2,
    timeoutMs: 20_000,
    retryableStatuses: TRANSIENT_STATUSES,
  },
  'create-order': {
    stance: 'never',
    maxAttempts: 1,
    // Duffel: "You must set a HTTP client timeout of at least 130s", because
    // the airline behind it can take 120. Anything shorter abandons an order
    // that may still be being created.
    timeoutMs: 140_000,
    retryableStatuses: [],
  },
  health: {
    stance: 'on-transient',
    maxAttempts: 1,
    timeoutMs: 5_000,
    retryableStatuses: TRANSIENT_STATUSES,
  },
};

/**
 * The policy for one operation on one provider.
 *
 * A provider may lengthen a timeout or reduce an attempt count, and may never
 * make a non-idempotent operation retryable: that stance is a property of what
 * the operation does, not of who is serving it.
 */
export function resolvePolicy(
  operation: ProviderOperation,
  metadata?: Pick<ProviderMetadata, 'operationOverrides'>,
): OperationPolicy {
  const base = DEFAULT_OPERATION_POLICIES[operation];
  const override = metadata?.operationOverrides?.[operation];

  if (!override) return base;

  return {
    ...base,
    ...override,
    // Not overridable, on purpose.
    stance: base.stance,
    maxAttempts: base.stance === 'never' ? 1 : (override.maxAttempts ?? base.maxAttempts),
  };
}

/** Whether a failed attempt should be repeated. */
export function shouldRetry(
  policy: OperationPolicy,
  attempt: number,
  status: number | null,
): boolean {
  if (policy.stance === 'never') return false;
  if (attempt >= policy.maxAttempts) return false;

  // A transport failure with no response - a timeout, a reset - is transient
  // for a read. For anything that creates state, `stance` already said no.
  if (status === null) return true;

  return policy.retryableStatuses.includes(status);
}

/**
 * How long to wait before the next attempt.
 *
 * A vendor's own `Retry-After` always wins: it knows when its window resets and
 * we are guessing. Otherwise exponential, because a provider that just
 * throttled us will still be throttling us a second later.
 */
export function retryDelayMs(attempt: number, retryAfterSeconds: number | null): number {
  if (retryAfterSeconds !== null && Number.isFinite(retryAfterSeconds)) {
    return Math.max(0, retryAfterSeconds * 1000);
  }

  return 1000 * 2 ** (attempt - 1);
}

/** Parse a `Retry-After` header. Seconds, or an HTTP date. */
export function parseRetryAfter(header: string | null, now: number = Date.now()): number | null {
  if (!header) return null;

  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(0, seconds);

  const date = Date.parse(header);
  return Number.isNaN(date) ? null : Math.max(0, (date - now) / 1000);
}
