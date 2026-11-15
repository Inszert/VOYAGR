import { afterEach, describe, expect, it } from 'vitest';
import { getSignInThrottle, resetSignInThrottle } from './throttle';

/**
 * The shared throttle instance itself, not the `SignInThrottle` class -
 * `service.test.ts` already covers the class's locking behaviour with an
 * injected instance. This is about the singleton getter: one shared
 * lockout counter per process, and a real reset between tests.
 */

describe('the process-wide throttle singleton', () => {
  afterEach(() => {
    resetSignInThrottle();
  });

  it('is one instance per process, not one per call', () => {
    expect(getSignInThrottle()).toBe(getSignInThrottle());
  });

  it('reset actually drops it, rather than handing back the same locked-out instance', () => {
    const first = getSignInThrottle();
    first.recordFailure('shared-key');
    expect(first.size).toBe(1);

    resetSignInThrottle();

    const second = getSignInThrottle();
    expect(second).not.toBe(first);
    expect(second.size).toBe(0);
  });
});

describe('memory is bounded by attacker-chosen keys', () => {
  it('SignInThrottle never remembers more than MAX_THROTTLE_KEYS clients', async () => {
    const { SignInThrottle, MAX_THROTTLE_KEYS } = await import('./throttle');
    const throttle = new SignInThrottle();
    for (let i = 0; i < MAX_THROTTLE_KEYS + 500; i++)
      throttle.recordFailure(`user-${i}@example.com`);
    expect(throttle.size).toBeLessThanOrEqual(MAX_THROTTLE_KEYS);
  });

  it('SendThrottle never remembers more than MAX_THROTTLE_KEYS windows', async () => {
    const { SendThrottle, MAX_THROTTLE_KEYS, ACCOUNT_SEND_LIMIT } = await import('./throttle');
    const throttle = new SendThrottle();
    for (let i = 0; i < MAX_THROTTLE_KEYS + 500; i++) {
      throttle.consume([{ key: `reset:account:${i}@example.com`, limit: ACCOUNT_SEND_LIMIT }]);
    }
    expect(throttle.size).toBeLessThanOrEqual(MAX_THROTTLE_KEYS);
  });
});
