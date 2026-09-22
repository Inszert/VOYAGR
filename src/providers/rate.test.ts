import { describe, expect, it } from 'vitest';
import { concurrencyFor } from './rate';

/**
 * How a declared rate limit becomes a concurrency bound.
 *
 * `rateLimitPerMinute` was declared on every adapter and read by nothing -
 * one of the mock-invisible assumptions the live-provider readiness gate
 * exists to settle. These fix what it now means.
 */
describe('concurrencyFor', () => {
  it('falls back to the search bound when a vendor states no limit', () => {
    // Not "unlimited": a vendor that has not said is not a vendor that has
    // said yes. Every mock declares null, which is why this keeps the whole
    // existing suite behaving exactly as it did.
    expect(concurrencyFor(null, 6)).toBe(6);
  });

  it('holds a vendor to one in-flight call per call-per-second it allows', () => {
    expect(concurrencyFor(600, 20)).toBe(10);
    expect(concurrencyFor(120, 20)).toBe(2);
  });

  it('never exceeds the search bound, however generous the vendor', () => {
    // A vendor allowing sixty thousand a minute is still not permission to
    // open a thousand sockets from one search.
    expect(concurrencyFor(60_000, 6)).toBe(6);
  });

  it('always allows at least one call, or the provider is unreachable', () => {
    // Anything under sixty a minute floors to zero, and a limiter of zero is
    // a provider that can never be called at all.
    expect(concurrencyFor(30, 6)).toBe(1);
    expect(concurrencyFor(1, 6)).toBe(1);
  });

  it('refuses a ceiling or a limit that cannot mean anything', () => {
    expect(() => concurrencyFor(null, 0)).toThrow(RangeError);
    expect(() => concurrencyFor(0, 6)).toThrow(RangeError);
    expect(() => concurrencyFor(-10, 6)).toThrow(RangeError);
  });
});
