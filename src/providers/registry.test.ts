import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseEnv, type Env } from '@/lib/env';
import { AppError } from '@/lib/errors';
import { ProviderRegistry } from './registry';

/**
 * The zero-billing policy, enforced at the provider boundary.
 *
 * Binding project decision, 2026-11-04: no paid API, ever - not a sandbox
 * key, not a free tier with unclear limits, nothing that can bill anyone
 * without a new, explicit decision. Duffel is the named, confirmed case
 * (the 2026-11-04 audit found it active in a real build's runtime config),
 * but the property these tests hold is general: an unapproved or unknown
 * `FLIGHT_PROVIDER` value must fail closed, before any adapter is built and
 * before any network call could happen - never fall back to a live vendor
 * silently.
 */

const env = (overrides: Partial<Env> = {}): Env =>
  ({
    NODE_ENV: 'development',
    FLIGHT_PROVIDER: 'mock',
    HOTEL_PROVIDER: 'mock',
    WEATHER_PROVIDER: 'mock',
    TRANSFER_PROVIDER: 'mock',
    PLACES_PROVIDER: 'mock',
    STAY_PROVIDERS: 'mock',
    VAPID_SUBJECT: 'mailto:dev@example.invalid',
    AI_PROVIDER: 'mock',
    AI_MODEL: 'claude-sonnet-5',
    EMAIL_PROVIDER: 'console',
    IMAGERY_PROVIDER: 'none',
    DATABASE_SSL: false,
    DATABASE_POOL_MAX: 10,
    QUEUE_DRIVER: 'memory',
    LOG_LEVEL: 'info',
    NEXT_PUBLIC_APP_URL: 'http://localhost:3000',
    ...overrides,
  }) as Env;

/**
 * Any adapter that reached the network would have to go through the global
 * `fetch`. Spying on it, rather than trusting the registry's own promise not
 * to call it, is what actually proves "zero outbound calls" instead of
 * assuming it.
 */
function spyOnFetch() {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
    throw new Error('fetch must not be called by this test');
  });
}

describe('Duffel cannot be selected or activated', () => {
  let fetchSpy: ReturnType<typeof spyOnFetch>;

  beforeEach(() => {
    fetchSpy = spyOnFetch();
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it('is not a value FLIGHT_PROVIDER can even hold', () => {
    // The schema itself refuses it - this is not "duffel without a token",
    // it is "duffel is not a word this field recognises any more", the same
    // way any other typo in this field already fails at parse time rather
    // than at the first search.
    expect(() => parseEnv({ FLIGHT_PROVIDER: 'duffel' })).toThrow(/FLIGHT_PROVIDER/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('cannot be reached through the registry even with a cast-through value', () => {
    // Belt and suspenders: even if something upstream of this registry
    // were to hand it a value TypeScript no longer allows (a stale cache,
    // a hand-built object, a future regression), the registry's own code
    // has no `duffel` branch left to match it - it falls through to the
    // same "not implemented" refusal every other unapproved provider gets.
    const smuggled = env({ FLIGHT_PROVIDER: 'duffel' as Env['FLIGHT_PROVIDER'] });

    expect(() => new ProviderRegistry(smuggled)).toThrow(AppError);
    expect(() => new ProviderRegistry(smuggled)).toThrow(/No live flights provider is implemented/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('has no DUFFEL field in the environment schema at all', () => {
    const parsed = parseEnv({ FLIGHT_PROVIDER: 'mock', DUFFEL: 'duffel_live_should_be_ignored' });

    expect(parsed).not.toHaveProperty('DUFFEL');
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('an unapproved or unknown provider fails closed', () => {
  let fetchSpy: ReturnType<typeof spyOnFetch>;

  beforeEach(() => {
    fetchSpy = spyOnFetch();
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it('refuses "live" for every provider kind rather than guessing an adapter', () => {
    for (const kind of ['FLIGHT_PROVIDER', 'HOTEL_PROVIDER', 'WEATHER_PROVIDER'] as const) {
      expect(() => new ProviderRegistry(env({ [kind]: 'live' } as Partial<Env>))).toThrow(AppError);
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('refuses aviasales with no token, rather than building a credential-less adapter', () => {
    expect(() => new ProviderRegistry(env({ FLIGHT_PROVIDER: 'aviasales' }))).toThrow(
      /AVIASALES_API_TOKEN is not set/,
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('is safe with no provider configuration at all - every kind defaults to mock', () => {
    const registry = new ProviderRegistry(env());

    expect(registry.isFullyMocked()).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('no user-controlled input can select a provider', () => {
  it("the data-source switch's own values are not provider names", async () => {
    // `src/providers/data-source.ts` accepts only 'api' | 'mock' from a
    // cookie - a caller-supplied value never names a vendor, Duffel or
    // otherwise. Covered directly in data-source.test.ts; asserted again
    // here, beside the registry, as the property this file is about.
    const { parseDataSource } = await import('./data-source');

    expect(parseDataSource('duffel')).toBeNull();
    expect(parseDataSource('aviasales')).toBeNull();
    expect(parseDataSource('live')).toBeNull();
  });
});
