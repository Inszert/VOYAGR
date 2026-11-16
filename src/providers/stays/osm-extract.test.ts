import { describe, expect, it } from 'vitest';
import recorded from '../../../tests/fixtures/providers/overpass-barcelona-stays.json';
import { stayListingSchema } from '../schema';
import dataset from './hotels.v1.generated.json';
import { coveredCities, HOTELS_CREDIT, loadStayListings } from './listings';
import { buildListingQuery, parseListingResponse, toListing } from './osm-extract';
import { resolveStayPlace } from './stay-place';

/**
 * The OpenStreetMap hotel extract: the query and parsing `scripts/build-hotels.mjs`
 * uses, against a real recorded Overpass answer for central Barcelona
 * (tests/fixtures/providers/overpass-barcelona-stays.json), and the loader
 * that reads the generated file. Nothing here reaches the network, and
 * nothing in the app calls Overpass at all (docs/provider-policy.md).
 */

const area = { south: 41.36, west: 2.13, north: 41.42, east: 2.21 };

describe('the Overpass query', () => {
  it('asks for the four kinds of stay, named, inside the box', () => {
    const query = buildListingQuery(area);
    expect(query).toContain('"tourism"~"^(hotel|guest_house|hostel|apartment)$"');
    expect(query).toContain('["name"](41.36,2.13,41.42,2.21)');
    expect(query).toContain('out center tags');
  });

  it('refuses a box that is not one', () => {
    expect(() => buildListingQuery({ ...area, south: 42 })).toThrow(RangeError);
    expect(() => buildListingQuery({ ...area, east: Number.NaN })).toThrow(RangeError);
  });
});

describe('the recorded response', () => {
  const parsed = parseListingResponse(recorded);

  it('becomes listings that all pass the boundary schema', () => {
    expect(parsed).not.toBeNull();
    expect(parsed!.listings.length).toBeGreaterThan(40);
    for (const listing of parsed!.listings) {
      expect(stayListingSchema.safeParse(listing).success).toBe(true);
    }
  });

  it('places a building by its centre', () => {
    const arts = parsed!.listings.find((listing) => listing.name === 'Hotel Arts');
    expect(arts?.id).toMatch(/^osm:way\//);
    expect(arts?.latitude).toBeCloseTo(41.3869, 3);
  });

  it('states what the map does not hold as null, never as a default', () => {
    const unstarred = parsed!.listings.filter((listing) => listing.stars === null);
    expect(unstarred.length).toBeGreaterThan(0);
    expect(parsed!.listings.some((listing) => listing.stars !== null)).toBe(true);
  });

  it('carries no price of any kind', () => {
    for (const listing of parsed!.listings) {
      expect(Object.keys(listing)).not.toEqual(expect.arrayContaining(['price']));
    }
  });

  it('drops an element that is not a stay rather than failing the list', () => {
    const body = {
      elements: [
        ...recorded.elements.slice(0, 3),
        { type: 'node', id: 1, lat: 41.4, lon: 2.17, tags: { tourism: 'museum', name: 'MNAC' } },
        { type: 'node', id: 2, tags: { tourism: 'hotel', name: 'Nowhere' } },
      ],
    };
    expect(parseListingResponse(body)?.listings.length).toBe(3);
  });

  it('keeps only an http(s) website, adding the scheme a mapper left off', () => {
    const base = { type: 'node', id: 9, lat: 41.4, lon: 2.17 };
    expect(
      toListing({ ...base, tags: { tourism: 'hotel', name: 'A', website: 'example.com' } }).website,
    ).toBe('https://example.com/');
    const website = toListing({
      ...base,
      tags: { tourism: 'hotel', name: 'A', website: 'javascript:alert(1)' },
    }).website;
    expect(website === null || String(website).startsWith('https://')).toBe(true);
  });

  it('is a failure, not an empty city, when the body is the wrong shape', () => {
    expect(parseListingResponse({ remark: 'runtime error' })).toBeNull();
  });
});

describe('the generated hotel file', () => {
  it('records its source, licence and retrieval date', () => {
    expect(HOTELS_CREDIT.attribution).toBe('© OpenStreetMap contributors');
    expect(HOTELS_CREDIT.licence).toMatch(/ODbL/);
    expect(HOTELS_CREDIT.retrievedAt).toMatch(/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/);
  });

  it('serves a covered city its hotels, every one through the boundary schema', () => {
    const code = coveredCities()[0]!;
    const [lon, lat] = (dataset.cities as unknown as Record<string, { centre: [number, number] }>)[
      code
    ]!.centre;
    const outcome = loadStayListings({ code, centre: { latitude: lat, longitude: lon } });

    expect(outcome.status).toBe('ok');
    if (outcome.status !== 'ok') return;
    expect(outcome.listings.length).toBeGreaterThan(0);
    for (const listing of outcome.listings) {
      expect(stayListingSchema.safeParse(listing).success).toBe(true);
    }
  });

  it('says absent for a city it does not cover, rather than asking anybody', () => {
    expect(loadStayListings({ code: 'ZZZ', centre: { latitude: 0, longitude: 0 } })).toEqual({
      status: 'absent',
    });
    expect(loadStayListings({ code: null, centre: { latitude: 0, longitude: 0 } }).status).toBe(
      'absent',
    );
  });
});

describe('resolveStayPlace', () => {
  it('finds a typed city by name, the largest of that name, at its centre', () => {
    const place = resolveStayPlace({ code: null, name: 'barcelona' });
    expect(place?.country).toBe('Spain');
    expect(place?.centre.latitude).toBeCloseTo(41.39, 1);
  });

  it('finds a city by the code a trip handed over', () => {
    expect(resolveStayPlace({ code: 'VIE', name: null })?.city).toBe('Vienna');
  });

  it('resolves a name it does not know to nothing', () => {
    expect(resolveStayPlace({ code: null, name: 'Atlantis' })).toBeNull();
  });
});
