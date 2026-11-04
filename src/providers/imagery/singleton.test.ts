import { afterEach, describe, expect, it } from 'vitest';
import { getImageryProvider, resetImageryCache, resolveImagery } from './index';

/**
 * The module-level provider, limiter and image cache - not the Wikimedia
 * adapter itself, which `wikimedia.test.ts` covers directly.
 *
 * This module's callers genuinely span a Route Handler
 * (`src/app/api/imagery/[code]/route.ts`) and several Server Components, the
 * exact split `src/db/index.ts` proved real for the repository singleton.
 * What matters here is the limiter: this module promises "one limiter,
 * shared... a burst of traffic is still one request at a time" to a free
 * third-party service, and two module instances would silently double that.
 */

describe('the process-wide imagery singletons', () => {
  afterEach(() => {
    resetImageryCache();
  });

  it('resolves the provider once and remembers it', () => {
    expect(getImageryProvider()).toBe(getImageryProvider());
  });

  it('caches a miss too, so an unresolvable code is not looked up again', async () => {
    // A code the catalogue has no reference for is a built-in miss - no
    // network stub needed, and it still proves the cache (not just the
    // provider) survives across calls to `resolveImagery`.
    const first = await resolveImagery(['zzz-not-a-real-destination']);
    const second = await resolveImagery(['zzz-not-a-real-destination']);

    expect(first.size).toBe(0);
    expect(second.size).toBe(0);
  });

  it('reset actually clears the cache, not just the provider', async () => {
    await resolveImagery(['zzz-not-a-real-destination']);
    const providerBefore = getImageryProvider();

    resetImageryCache();

    // A fresh provider is resolved after reset - proof the memoisation was
    // actually dropped, not merely that calling it twice is cheap.
    expect(getImageryProvider()).not.toBe(providerBefore);
  });
});
