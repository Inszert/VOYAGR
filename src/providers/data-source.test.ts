import { describe, expect, it } from 'vitest';
import type { Env } from '@/lib/env';
import { getProviderRegistry, resetProviderRegistry } from './registry';
import { getStayProviders, resetStayProviders } from './stays/registry';
import {
  configuredDataSource,
  dataSourceSwitchEnabled,
  parseDataSource,
  DATA_SOURCE_COOKIE,
} from './data-source';

/**
 * The runtime data-source switch.
 *
 * What is pinned here is the property that makes the switch safe to ship:
 * **the label and the data can never disagree**. Asking for fixtures always
 * gets fixtures; asking for the API gets whatever configuration actually
 * names, and never a fixture wearing an API label.
 */

const env = (overrides: Partial<Env> = {}): Env =>
  ({
    NODE_ENV: 'development',
    FLIGHT_PROVIDER: 'mock',
    HOTEL_PROVIDER: 'mock',
    WEATHER_PROVIDER: 'mock',
    TRANSFER_PROVIDER: 'mock',
    PLACES_PROVIDER: 'mock',
    ...overrides,
  }) as Env;

describe('parseDataSource', () => {
  it('accepts only the two sources it knows', () => {
    expect(parseDataSource('api')).toBe('api');
    expect(parseDataSource('mock')).toBe('mock');
  });

  it('refuses anything else rather than guessing', () => {
    // A cookie is caller-supplied. "live", "duffel" and "" are all somebody
    // else's word for something, and none of them is a source here.
    expect(parseDataSource('live')).toBeNull();
    expect(parseDataSource('duffel')).toBeNull();
    expect(parseDataSource('')).toBeNull();
    expect(parseDataSource(undefined)).toBeNull();
  });

  it('names its cookie once, for both the reader and the writer', () => {
    expect(DATA_SOURCE_COOKIE).toBe('voyagr-data-source');
  });
});

describe('configuredDataSource', () => {
  it('is api wherever a real adapter is configured', () => {
    expect(configuredDataSource(env({ FLIGHT_PROVIDER: 'aviasales' }))).toBe('api');
  });

  it('is mock where nothing real is configured', () => {
    // A deployment with no credentials is already serving fixtures. The
    // switch starts where the deployment already is.
    expect(configuredDataSource(env())).toBe('mock');
  });
});

describe('dataSourceSwitchEnabled', () => {
  it('is on where development happens and off in production', () => {
    expect(dataSourceSwitchEnabled(env({ NODE_ENV: 'development' }))).toBe(true);
    expect(dataSourceSwitchEnabled(env({ NODE_ENV: 'production' }))).toBe(false);
  });

  it('is off when real flights are configured, so fixture flights are not one cookie away', () => {
    expect(dataSourceSwitchEnabled(env({ FLIGHT_PROVIDER: 'aviasales' }))).toBe(false);
    // ...but a person can still ask for it by name.
    expect(
      dataSourceSwitchEnabled(env({ FLIGHT_PROVIDER: 'aviasales', DATA_SOURCE_SWITCH: true })),
    ).toBe(true);
  });

  it('stays off in production even when asked for, unless fixtures are explicitly allowed', () => {
    expect(dataSourceSwitchEnabled(env({ NODE_ENV: 'production', DATA_SOURCE_SWITCH: true }))).toBe(
      false,
    );
  });

  it('can be turned on or off explicitly', () => {
    expect(
      dataSourceSwitchEnabled(
        env({ NODE_ENV: 'production', DATA_SOURCE_SWITCH: true, ALLOW_MOCK_IN_PRODUCTION: true }),
      ),
    ).toBe(true);
    expect(
      dataSourceSwitchEnabled(env({ NODE_ENV: 'development', DATA_SOURCE_SWITCH: false })),
    ).toBe(false);
  });
});

describe('the registry a source resolves to', () => {
  it('serves fixtures for mock, whatever is configured', () => {
    resetProviderRegistry();

    const mocked = getProviderRegistry('mock');

    expect(mocked.isFullyMocked()).toBe(true);
    expect(mocked.flights.metadata.isMock).toBe(true);
  });

  it('keeps the two registries apart rather than returning one for both', () => {
    resetProviderRegistry();

    // Same object back for the same source, and a different one for the
    // other: an adapter is stateless, so sharing is safe, but sharing
    // *across* sources would be the switch doing nothing at all.
    expect(getProviderRegistry('mock')).toBe(getProviderRegistry('mock'));
    expect(getProviderRegistry('mock')).not.toBe(getProviderRegistry('api'));
  });

  it('gives the stay search its fixtures for mock', () => {
    resetStayProviders();

    const providers = getStayProviders(env({ STAY_PROVIDERS: 'mock' }), 'mock');

    expect(providers.length).toBeGreaterThan(0);
    expect(providers.every((provider) => provider.metadata.isMock)).toBe(true);
  });
});
