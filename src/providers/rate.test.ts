import { describe, expect, it } from 'vitest';
import { callsWithin, concurrencyFor } from './rate';

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
    expect(() => concurrencyFor(600, 6, 0)).toThrow(RangeError);
    expect(() => concurrencyFor(600, 6, -1)).toThrow(RangeError);
  });

  it('lets a slow vendor be driven at the quota it actually allows', () => {
    // Duffel: thirty a minute, four and a half seconds a call. Two in flight
    // is twenty-six calls a minute - inside the quota - where the flat
    // one-second assumption allowed one and left half the allowance unused.
    expect(concurrencyFor(30, 6)).toBe(1);
    expect(concurrencyFor(30, 6, 4_500)).toBe(2);
  });

  it('holds a fast vendor back rather than letting latency flatter it', () => {
    // Six hundred a minute answered in a tenth of a second is one a second
    // sustained: ten at once would be six thousand a minute.
    expect(concurrencyFor(600, 20, 100)).toBe(1);
  });
});

/**
 * How many calls fit in the time somebody is willing to wait.
 *
 * The planning half of the same measurement: a fan-out sized for mocks is a
 * fan-out sized against a provider that costs nothing.
 */
describe('callsWithin', () => {
  it('lets an unmeasured provider have one call per assumed second', () => {
    expect(callsWithin(12_000, 1, null)).toBe(12);
    expect(callsWithin(12_000, 6, null)).toBe(72);
  });

  it('plans four date windows against a vendor answering in four seconds', () => {
    // Twelve seconds, two in flight, four and a half seconds a call: two
    // rounds of two. Eight windows against this vendor is eighteen seconds
    // of waiting for the same trips.
    expect(callsWithin(12_000, 2, 4_500)).toBe(4);
  });

  it('never plans zero calls, however slow the vendor', () => {
    // A search that can afford no calls is not a fast search.
    expect(callsWithin(1_000, 1, 30_000)).toBe(1);
  });

  it('refuses a budget or a concurrency that cannot mean anything', () => {
    expect(() => callsWithin(0, 1, null)).toThrow(RangeError);
    expect(() => callsWithin(12_000, 0, null)).toThrow(RangeError);
  });
});
