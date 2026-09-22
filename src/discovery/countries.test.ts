import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DESTINATION_FIXTURES } from '@/providers/fixtures/destinations';
import { AIRPORT_FIXTURES } from '@/providers/fixtures/airports';
import { COUNTRIES, findCountry, parseCountry } from './countries';

/**
 * The shipped country data.
 *
 * These are data tests, in the spirit of the end-to-end check that the globe
 * reaches nobody: they pin the properties the product relies on, so a rebuild
 * of the geo files that lost a key or a bound fails here rather than on a
 * globe that quietly stops selecting.
 */

interface ShippedFeature {
  readonly properties: { readonly adm0: string; readonly bbox: readonly number[] };
  readonly geometry: { readonly type: string };
}

const shipped = JSON.parse(readFileSync('public/geo/countries-110m.v2.json', 'utf8')) as {
  features: readonly ShippedFeature[];
};

describe('the country index', () => {
  it('holds every Natural Earth admin-0 country once, with a unique key', () => {
    expect(COUNTRIES).toHaveLength(177);
    expect(new Set(COUNTRIES.map((country) => country.adm0)).size).toBe(COUNTRIES.length);
  });

  it('agrees with the geometry the browser fetches', () => {
    const geometryKeys = new Set(shipped.features.map((feature) => feature.properties.adm0));

    expect(shipped.features).toHaveLength(COUNTRIES.length);
    for (const country of COUNTRIES) expect(geometryKeys.has(country.adm0)).toBe(true);
  });

  it('gives every country a bounding box the globe can fly to', () => {
    for (const country of COUNTRIES) {
      const [west, south, east, north] = country.bbox;

      expect(south).toBeGreaterThanOrEqual(-90);
      expect(north).toBeLessThanOrEqual(90);
      expect(south).toBeLessThan(north);
      // East is written past 180 for a country across the antimeridian, so the
      // box never wraps the wrong way round the planet.
      expect(west).toBeLessThan(east);
      expect(east - west).toBeLessThanOrEqual(360);
    }
  });

  it('keys on ADM0_A3, so France and Norway are not -99', () => {
    expect(findCountry('FRA')?.name).toBe('France');
    expect(findCountry('NOR')?.name).toBe('Norway');
    expect(findCountry('-99')).toBeNull();
  });

  it('names countries in full, not by the abbreviation Natural Earth draws', () => {
    expect(findCountry('COD')?.name).toBe('Democratic Republic of the Congo');
    expect(findCountry('COD')?.shortName).toBe('Dem. Rep. Congo');
  });

  it('is sorted by name, so a picker reads in order', () => {
    const names = COUNTRIES.map((country) => country.name);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b, 'en')));
  });
});

describe('parseCountry', () => {
  it('accepts a known key in any case', () => {
    expect(parseCountry('esp')?.name).toBe('Spain');
    expect(parseCountry('ESP')?.name).toBe('Spain');
  });

  it('reads anything else as no selection', () => {
    expect(parseCountry(undefined)).toBeNull();
    expect(parseCountry('')).toBeNull();
    expect(parseCountry('Spain')).toBeNull();
    expect(parseCountry('ES')).toBeNull();
    expect(parseCountry('ZZZ')).toBeNull();
  });
});

describe('the fixtures', () => {
  it('place every destination in a country that exists', () => {
    for (const fixture of DESTINATION_FIXTURES) {
      expect(fixture.adm0, fixture.airport).not.toBeNull();
      expect(findCountry(fixture.adm0!), fixture.airport).not.toBeNull();
    }
  });

  it('place every origin airport in a country that exists', () => {
    for (const airport of AIRPORT_FIXTURES) {
      expect(findCountry(airport.adm0), airport.code).not.toBeNull();
    }
  });
});
