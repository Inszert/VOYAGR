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
