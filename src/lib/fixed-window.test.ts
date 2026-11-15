import { describe, expect, it } from 'vitest';
import { FixedWindowLimiter } from './fixed-window';

describe('FixedWindowLimiter', () => {
  it('allows max takes per window per key, then refuses with a wait', () => {
    let now = 0;
    const limiter = new FixedWindowLimiter({ max: 2, windowMs: 60_000, now: () => now });

    expect(limiter.take('a').allowed).toBe(true);
    expect(limiter.take('a').allowed).toBe(true);
    now = 10_000;
    expect(limiter.take('a')).toEqual({ allowed: false, retryAfterSeconds: 50 });
    // Another key is unaffected.
    expect(limiter.take('b').allowed).toBe(true);
  });

  it('turns the window over', () => {
    let now = 0;
    const limiter = new FixedWindowLimiter({ max: 1, windowMs: 1_000, now: () => now });
    limiter.take('a');
    expect(limiter.take('a').allowed).toBe(false);
    now = 1_000;
    expect(limiter.take('a').allowed).toBe(true);
  });

  it('does not extend the wait when refused', () => {
    let now = 0;
    const limiter = new FixedWindowLimiter({ max: 1, windowMs: 1_000, now: () => now });
    limiter.take('a');
    for (let i = 0; i < 50; i++) limiter.take('a');
    now = 1_000;
    expect(limiter.take('a').allowed).toBe(true);
  });

  it('cannot be grown without bound by attacker-chosen keys', () => {
    const limiter = new FixedWindowLimiter({ max: 5, windowMs: 60_000, maxKeys: 100 });
    for (let i = 0; i < 10_000; i++) limiter.take(`key-${i}`);
    expect(limiter.size).toBeLessThanOrEqual(100);
  });
});
