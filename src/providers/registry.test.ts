import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseEnv, type Env } from '@/lib/env';
import { AppError } from '@/lib/errors';
import {
  combineProvenance,
  demoDataSentence,
  provenanceForMetadata,
  type SourceAttribution,
} from '@/core/trip/provenance';
import { assertNoMockInProduction, ProviderRegistry } from './registry';
import { getStayProviders, resetStayProviders } from './stays/registry';

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

  it('refuses liteapi with no key, before any request', () => {
    for (const kind of ['FLIGHT_PROVIDER', 'HOTEL_PROVIDER', 'EXPERIENCE_PROVIDER'] as const) {
      expect(() => new ProviderRegistry(env({ [kind]: 'liteapi' } as Partial<Env>))).toThrow(
        /LITEAPI_API_KEY is not set/,
      );
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('fails closed on liteapi with a key while no adapter exists, never serving a mock', () => {
    for (const kind of ['FLIGHT_PROVIDER', 'HOTEL_PROVIDER'] as const) {
      expect(
        () =>
          new ProviderRegistry(env({ [kind]: 'liteapi', LITEAPI_API_KEY: 'k' } as Partial<Env>)),
      ).toThrow(AppError);
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('refuses a sandbox key in production unless the flag is set, and never names the key', () => {
    const base = {
      NODE_ENV: 'production',
      NEXT_PUBLIC_APP_URL: 'https://voyagr.example',
      LITEAPI_API_KEY: 'sand_secret123',
    };
    let message = '';
    try {
      parseEnv(base);
    } catch (error) {
      message = String((error as Error).message);
    }
    expect(message).toMatch(/LITEAPI_SANDBOX_IN_PRODUCTION/);
    expect(message).not.toContain('sand_secret123');

    expect(parseEnv({ ...base, LITEAPI_SANDBOX_IN_PRODUCTION: 'true' }).LITEAPI_API_KEY).toBe(
      'sand_secret123',
    );
    // A non-sandbox key and a development build are not affected.
    expect(() => parseEnv({ ...base, LITEAPI_API_KEY: 'prod_key' })).not.toThrow();
    expect(() => parseEnv({ ...base, NODE_ENV: 'development' })).not.toThrow();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('reads no LiteAPI choice from anything but the environment', () => {
    expect(parseEnv({}).LITEAPI_GUEST_NATIONALITY).toBe('US');
    expect(parseEnv({ LITEAPI_GUEST_NATIONALITY: 'gb' }).LITEAPI_GUEST_NATIONALITY).toBe('GB');
    expect(() => parseEnv({ LITEAPI_GUEST_NATIONALITY: 'GBR' })).toThrow();
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

describe('production serves no fixtures', () => {
  const production = (overrides: Partial<Env> = {}) =>
    env({
      NODE_ENV: 'production',
      FLIGHT_PROVIDER: 'aviasales',
      AVIASALES_API_TOKEN: 'token-for-test',
      HOTEL_PROVIDER: 'absent',
      WEATHER_PROVIDER: 'open-meteo',
      TRANSFER_PROVIDER: 'absent',
      PLACES_PROVIDER: 'absent',
      STAY_PROVIDERS: 'absent',
      ...overrides,
    });

  it('builds a registry in which no slot is a mock', () => {
    const registry = new ProviderRegistry(production());

    for (const provider of registry.all()) {
      expect(provider.metadata.isMock, `${provider.metadata.kind} is a mock`).toBe(false);
    }
    expect(() => assertNoMockInProduction(registry, production())).not.toThrow();
  });

  it('refuses a mock flight, hotel or weather provider, naming the slot', () => {
    for (const [kind, name] of [
      ['FLIGHT_PROVIDER', 'FLIGHTS'],
      ['HOTEL_PROVIDER', 'HOTELS'],
      ['WEATHER_PROVIDER', 'WEATHER'],
    ] as const) {
      const config = production({ [kind]: 'mock' } as Partial<Env>);

      expect(() => new ProviderRegistry(config)).toThrow(AppError);
      expect(() => new ProviderRegistry(config)).toThrow(new RegExp(`${name}_PROVIDER is "mock"`));
    }
  });

  it('resolves transfers and places to absent, never to a mock, even when asked for one', () => {
    const registry = new ProviderRegistry(
      production({ TRANSFER_PROVIDER: 'mock', PLACES_PROVIDER: 'mock' }),
    );

    expect(registry.transfers.metadata.mode).toBe('absent');
    expect(registry.places.metadata.mode).toBe('absent');
    expect(registry.isFullyMocked()).toBe(false);
  });

  it('resolves places to Wikidata when asked, which is real and keyless', () => {
    const registry = new ProviderRegistry(production({ PLACES_PROVIDER: 'wikidata' }));

    expect(registry.places.metadata).toMatchObject({ id: 'wikidata', isMock: false });
    expect(() => assertNoMockInProduction(registry, production())).not.toThrow();
  });

  it('marks absent slots in the probe results so health can tell them from an outage', async () => {
    const registry = new ProviderRegistry(production({ PLACES_PROVIDER: 'absent' }));
    const checked = await registry.checkAll();

    expect(checked.hotels?.mode).toBe('absent');
    expect(checked.transfers?.mode).toBe('absent');
    expect(checked.places?.mode).toBe('absent');
    expect(checked.weather?.mode).not.toBe('absent');
  });

  it('answers an absent slot with nothing, so the cost line is excluded rather than zero', async () => {
    const registry = new ProviderRegistry(production());

    const transfers = await registry.transfers.searchTransfers({
      airport: 'VIE',
      destinationName: 'Vienna',
      passengers: 2,
      currency: 'EUR',
    });
    const hotels = await registry.hotels.searchHotels({
      destination: 'VIE',
      checkIn: '2027-06-01',
      checkOut: '2027-06-04',
      guests: 2,
      currency: 'EUR',
    });

    expect(transfers).toEqual({ ok: true, value: [] });
    expect(hotels.ok).toBe(false);
    if (!hotels.ok) expect(hotels.error.code).toBe('PROVIDER_UNAVAILABLE');
  });

  it('guards the finished registry, not only each resolver', () => {
    const registry = new ProviderRegistry(env());

    expect(() => assertNoMockInProduction(registry, { NODE_ENV: 'production' } as Env)).toThrow(
      /Production resolved fixture providers: .*flights/,
    );
    expect(() =>
      assertNoMockInProduction(registry, { NODE_ENV: 'development' } as Env),
    ).not.toThrow();
  });

  it('serves fixtures only when a production build explicitly opts in', () => {
    const registry = new ProviderRegistry(
      env({ NODE_ENV: 'production', ALLOW_MOCK_IN_PRODUCTION: true }),
    );

    expect(registry.isFullyMocked()).toBe(true);
  });

  it('never reports a demo claim about slots that are absent', () => {
    const registry = new ProviderRegistry(production());
    const sources: SourceAttribution[] = [
      { part: 'transfers', providerId: 'absent', displayName: 'Not available' },
      { part: 'hotels', providerId: 'absent', displayName: 'Not available' },
    ].map((source) => ({
      ...source,
      part: source.part as SourceAttribution['part'],
      provenance: provenanceForMetadata(
        source.part === 'transfers' ? registry.transfers.metadata : registry.hotels.metadata,
      ),
    }));

    expect(sources.every((source) => source.provenance === 'unavailable')).toBe(true);
    expect(combineProvenance(sources.map((source) => source.provenance))).not.toBe('mock');
    expect(demoDataSentence(sources)).toBeNull();
  });

  it('never resolves a mock stay provider in production, whatever STAY_PROVIDERS says', () => {
    resetStayProviders();
    expect(() => getStayProviders(production({ STAY_PROVIDERS: 'mock' }))).toThrow(
      /STAY_PROVIDERS names "mock" in production/,
    );

    resetStayProviders();
    expect(
      getStayProviders(production({ STAY_PROVIDERS: 'nonsense' })).map((p) => p.metadata.mode),
    ).toEqual(['absent']);
    // And through the mock data source, which is what the dev switch asks for.
    resetStayProviders();
    expect(() => getStayProviders(production(), 'mock')).toThrow(AppError);
    resetStayProviders();
  });
});
