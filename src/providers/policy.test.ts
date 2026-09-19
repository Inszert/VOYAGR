import { describe, expect, it } from 'vitest';
import {
  DEFAULT_OPERATION_POLICIES,
  parseRetryAfter,
  resolvePolicy,
  retryDelayMs,
  shouldRetry,
} from './policy';

/**
 * Provider policy.
 *
 * Every rule here comes from something the live-provider research found, and
 * the tests name which. The one that matters most: an operation that creates
 * something is never retried automatically, because a timeout on order
 * creation does not mean the order was not created.
 */

describe('retry stance', () => {
  it('never retries an operation that creates something', () => {
    // Duffel: a 202 on order creation "may result in a duplicate order or
    // booking". Retrying turns "we do not know" into "definitely two".
    const policy = DEFAULT_OPERATION_POLICIES['create-order'];

    expect(policy.stance).toBe('never');
    expect(policy.maxAttempts).toBe(1);
    expect(shouldRetry(policy, 1, 503)).toBe(false);
    expect(shouldRetry(policy, 1, null)).toBe(false);
    expect(shouldRetry(policy, 1, 429)).toBe(false);
  });

  it('retries a search on a transient failure', () => {
    const policy = DEFAULT_OPERATION_POLICIES.search;

    for (const status of [429, 500, 502, 503, 504]) {
      expect(shouldRetry(policy, 1, status)).toBe(true);
    }
  });

  it('does not retry our own mistakes', () => {
    // A 400 or a 401 will be a 400 or a 401 again in a second.
    const policy = DEFAULT_OPERATION_POLICIES.search;

    for (const status of [400, 401, 403, 404, 422]) {
      expect(shouldRetry(policy, 1, status)).toBe(false);
    }
  });

  it('treats a transport failure with no response as transient, for a read', () => {
    expect(shouldRetry(DEFAULT_OPERATION_POLICIES.search, 1, null)).toBe(true);
  });

  it('stops once the attempts are spent', () => {
    const policy = DEFAULT_OPERATION_POLICIES.search;

    expect(shouldRetry(policy, policy.maxAttempts - 1, 503)).toBe(true);
    expect(shouldRetry(policy, policy.maxAttempts, 503)).toBe(false);
  });
});

describe('timeouts', () => {
  it('gives order creation far longer than a search', () => {
    // Duffel: "You must set a HTTP client timeout of at least 130s", because
    // the airline behind it can take 120.
    expect(DEFAULT_OPERATION_POLICIES['create-order'].timeoutMs).toBeGreaterThanOrEqual(130_000);
    expect(DEFAULT_OPERATION_POLICIES.search.timeoutMs).toBeLessThan(15_000);
  });

  it('keeps the health probe cheap', () => {
    expect(DEFAULT_OPERATION_POLICIES.health.timeoutMs).toBeLessThan(
      DEFAULT_OPERATION_POLICIES.search.timeoutMs,
    );
  });
});

describe('resolvePolicy', () => {
  it('uses the defaults when a provider says nothing', () => {
    expect(resolvePolicy('search')).toEqual(DEFAULT_OPERATION_POLICIES.search);
  });

  it('lets a provider lengthen its own timeout', () => {
    // One vendor's search budget is not another's.
    const policy = resolvePolicy('search', {
      operationOverrides: { search: { timeoutMs: 30_000 } },
    });

    expect(policy.timeoutMs).toBe(30_000);
    expect(policy.maxAttempts).toBe(DEFAULT_OPERATION_POLICIES.search.maxAttempts);
  });

  it('refuses to let a provider make order creation retryable', () => {
    // The stance is a property of what the operation does, not of who serves
    // it. A vendor cannot opt into duplicate bookings on our behalf.
    const policy = resolvePolicy('create-order', {
      operationOverrides: { 'create-order': { maxAttempts: 5 } },
    });

    expect(policy.stance).toBe('never');
    expect(policy.maxAttempts).toBe(1);
  });
});

describe('backoff', () => {
  it('always prefers the vendor’s own Retry-After', () => {
    // It knows when its window resets; we are guessing.
    expect(retryDelayMs(1, 30)).toBe(30_000);
    expect(retryDelayMs(3, 5)).toBe(5_000);
  });

  it('backs off exponentially when the vendor said nothing', () => {
    expect(retryDelayMs(1, null)).toBe(1_000);
    expect(retryDelayMs(2, null)).toBe(2_000);
    expect(retryDelayMs(3, null)).toBe(4_000);
  });

  it('reads Retry-After as seconds or as a date', () => {
    const now = Date.parse('2026-09-19T12:00:00.000Z');

    expect(parseRetryAfter('30', now)).toBe(30);
    expect(parseRetryAfter('Sat, 19 Sep 2026 12:00:45 GMT', now)).toBe(45);
    expect(parseRetryAfter(null, now)).toBeNull();
    expect(parseRetryAfter('nonsense', now)).toBeNull();
  });

  it('never waits a negative amount of time', () => {
    const now = Date.parse('2026-09-19T12:00:00.000Z');
    expect(parseRetryAfter('Sat, 19 Sep 2026 11:00:00 GMT', now)).toBe(0);
  });
});
