import { describe, expect, it, vi } from 'vitest';
import { loadCassette, replayingFetch } from '../http/cassette';
import type { FetchLike } from '../http/types';
import {
  ENOUGH_PLACES,
  NEAR_RADIUS_KM,
  WIDE_RADIUS_KM,
  buildCentreQuery,
  buildPlacesQuery,
  createWikidataPlacesProvider,
  imageFileFrom,
  parseCentre,
  parsePlaces,
  parsePoint,
} from './wikidata';

/**
 * The Wikidata adapter, offline.
 *
 * `wikidata-antalya` is a real exchange recorded through this adapter against
 * the live Query Service (see the fixtures' README): the city-centre lookup and
 * the places within 15 km. Nothing here reaches the network - the replaying
 * `fetch` throws for a request the cassette does not hold.
 */

const ANTALYA = {
  destination: 'AYT',
  destinationName: 'Antalya',
  // The airport, 10 km east of the city: the adapter must not measure from here.
  position: [30.79, 36.9] as const,
};

function antalya() {
  return createWikidataPlacesProvider({
    fetchImpl: replayingFetch(loadCassette('wikidata-antalya')),
  });
}

const CENTRE = { latitude: 36.90812, longitude: 30.69556 };

function binding(id: string, overrides: Record<string, unknown> = {}) {
  const term = (value: string) => ({ type: 'literal', value });

  return {
    item: term(`http://www.wikidata.org/entity/${id}`),
    itemLabel: term(`Place ${id}`),
    coord: term('Point(30.7 36.9)'),
    sitelinks: term('5'),
    class: term('http://www.wikidata.org/entity/Q570116'),
    ...overrides,
  };
}

const response = (...bindings: unknown[]) => ({ results: { bindings } });

describe('the recorded Antalya response', () => {
  it('returns real places, best documented first, each with its facts or an explicit null', async () => {
    const result = await antalya().thingsToDo(ANTALYA);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const places = result.value;
    expect(places.length).toBeGreaterThanOrEqual(10);
    expect(places.length).toBeLessThanOrEqual(60);

    const gate = places.find((place) => place.name === "Hadrian's Gate");
    expect(gate).toMatchObject({
      id: 'Q1283114',
      providerId: 'wikidata',
      kind: 'sights',
      description: 'triumphal arch in Antalya',
      notability: 20,
      wikipediaUrl: 'https://en.wikipedia.org/wiki/Hadrian%27s_Gate',
    });
    expect(gate?.imageFile).toMatch(/\.jpe?g$/i);

    // A place the source states no picture, article or description for says so with null.
    const toyMuseum = places.find((place) => place.id === 'Q6055656');
    expect(toyMuseum).toMatchObject({ description: null, wikipediaUrl: null, kind: 'museums' });
    expect(places.some((place) => place.imageFile === null)).toBe(true);
  });

  it('ranks by sitelink count, then nearness, then id, and is the same every time', async () => {
    const first = await antalya().thingsToDo(ANTALYA);
    const second = await antalya().thingsToDo(ANTALYA);

    expect(first).toEqual(second);
    if (!first.ok) throw new Error('expected a result');

    const ranked = first.value;
    for (let index = 1; index < ranked.length; index += 1) {
      const before = ranked[index - 1]!;
      const after = ranked[index]!;

      expect(before.notability).toBeGreaterThanOrEqual(after.notability);
      if (before.notability === after.notability) {
        expect(before.distanceFromCentreMetres).toBeLessThanOrEqual(after.distanceFromCentreMetres);
      }
    }
  });

  it('measures from the city centre, not from the airport it was given', async () => {
    const result = await antalya().thingsToDo(ANTALYA);
    if (!result.ok) throw new Error('expected a result');

    // Hadrian's Gate is in the old town, about 2.8 km from the centre and about
    // 10 km from the airport; the figure must be the first.
    const gate = result.value.find((place) => place.id === 'Q1283114');
    expect(gate?.distanceFromCentreMetres).toBeGreaterThan(2_000);
    expect(gate?.distanceFromCentreMetres).toBeLessThan(4_000);
  });

  it('has no duplicate places and no administrative neighbourhoods', async () => {
    const result = await antalya().thingsToDo(ANTALYA);
    if (!result.ok) throw new Error('expected a result');

    const ids = result.value.map((place) => place.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(result.value.every((place) => !/mahalle/i.test(place.description ?? ''))).toBe(true);
  });

  it('honours the result limit', async () => {
    const result = await antalya().thingsToDo({ ...ANTALYA, maxResults: 3 });

    expect(result.ok && result.value.length).toBe(3);
  });
});

describe('the queries', () => {
  it('asks the Query Service, and says who is asking', async () => {
    const seen: { url: string; agent: string | undefined }[] = [];
    const fetchImpl: FetchLike = async (url, init) => {
      seen.push({ url, agent: (init?.headers as Record<string, string>)['User-Agent'] });
      return new Response(JSON.stringify(response()), { status: 200 });
    };

    await createWikidataPlacesProvider({ fetchImpl }).thingsToDo(ANTALYA);

    expect(seen.every((call) => call.url.startsWith('https://query.wikidata.org/sparql?'))).toBe(
      true,
    );
    expect(seen.every((call) => call.agent === 'Voyagr/1.0 (https://www.voyagrfind.com)')).toBe(
      true,
    );
  });

  it('asks for 15 km, then 30 km only when 15 km found fewer than ten', async () => {
    const radii: number[] = [];
    const few = Array.from({ length: ENOUGH_PLACES - 1 }, (_, index) => binding(`Q${index + 1}`));
    const many = Array.from({ length: ENOUGH_PLACES + 5 }, (_, index) => binding(`Q${index + 1}`));

    const run = async (near: unknown[], wide: unknown[]) => {
      radii.length = 0;
      const fetchImpl: FetchLike = async (url) => {
        const query = new URL(url).searchParams.get('query') ?? '';
        const radius = /wikibase:radius "(\d+)"/.exec(query)?.[1];
        if (/rdfs:label "Antalya"@en/.test(query)) {
          return new Response(JSON.stringify(response({ coord: { value: 'Point(30.7 36.9)' } })));
        }
        radii.push(Number(radius));
        return new Response(JSON.stringify(response(...(Number(radius) === 15 ? near : wide))));
      };

      return createWikidataPlacesProvider({ fetchImpl }).thingsToDo(ANTALYA);
    };

    await run(many, many);
    expect(radii).toEqual([NEAR_RADIUS_KM]);

    const widened = await run(few, many);
    expect(radii).toEqual([NEAR_RADIUS_KM, WIDE_RADIUS_KM]);
    expect(widened.ok && widened.value.length).toBe(many.length);

    // A wider search that finds nothing more keeps the first answer.
    const same = await run(few, few);
    expect(same.ok && same.value.length).toBe(few.length);
  });

  it('keeps a quote or a backslash in a city name inside its string literal', () => {
    const query = buildCentreQuery('Ho "Chi" \\ Minh', [106.7, 10.8]);

    expect(query).toContain('"Ho \\"Chi\\" \\\\ Minh"@en');
  });

  it('refuses a name with a control character rather than building a query from it', () => {
    expect(() => buildCentreQuery('Anta\nlya', [30, 36])).toThrow(RangeError);
  });

  it('refuses a radius that is not a sensible number of kilometres', () => {
    expect(() => buildPlacesQuery([30, 36], 0)).toThrow(RangeError);
    expect(() => buildPlacesQuery([30, 36], Number.NaN)).toThrow(RangeError);
    expect(() => buildPlacesQuery([30, 36], 101)).toThrow(RangeError);
    expect(buildPlacesQuery([30, 36], 15)).toContain('wikibase:radius "15"');
    // Order matters to the service: circle and sitelink floor first, class check after.
    expect(buildPlacesQuery([30, 36], 15)).toContain('hint:optimizer "None"');
  });

  it('falls back to the given position when the city has no centre of its own', async () => {
    const queries: string[] = [];
    const fetchImpl: FetchLike = async (url) => {
      queries.push(new URL(url).searchParams.get('query') ?? '');
      return new Response(JSON.stringify(response()));
    };

    await createWikidataPlacesProvider({ fetchImpl }).thingsToDo(ANTALYA);

    expect(queries[1]).toContain('Point(30.79 36.9)');
  });
});

describe('the boundary', () => {
  it('drops a row with no usable coordinate rather than placing it somewhere', () => {
    const { places, rejected } = parsePlaces(
      response(
        binding('Q1'),
        binding('Q2', { coord: { value: 'not a point' } }),
        binding('Q3', { coord: { value: 'Point(30.7 400)' } }),
      ),
      CENTRE,
      'wikidata',
    );

    expect(places.map((place) => place.id)).toEqual(['Q1']);
    expect(rejected).toBe(2);
  });

  it('drops a row with no English label, or only an item id for one', () => {
    const { places } = parsePlaces(
      response(
        binding('Q1'),
        binding('Q2', { itemLabel: { value: '' } }),
        binding('Q3', { itemLabel: { value: 'Q3' } }),
      ),
      CENTRE,
      'wikidata',
    );

    expect(places.map((place) => place.id)).toEqual(['Q1']);
  });

  it('drops a row that is not an object, or is missing a required field, and says how many', () => {
    const { places, rejected } = parsePlaces(
      response(binding('Q1'), 'nonsense', { item: { value: 'http://x/entity/Q9' } }, null),
      CENTRE,
      'wikidata',
    );

    expect(places).toHaveLength(1);
    expect(rejected).toBe(3);
  });

  it('drops an item whose class belongs to no group, and one whose id is not a Wikidata id', () => {
    const { places, rejected } = parsePlaces(
      response(
        binding('Q1'),
        binding('Q2', { class: { value: 'http://www.wikidata.org/entity/Q999999999' } }),
        binding('Q3', { item: { value: 'http://www.wikidata.org/entity/Q3; DROP' } }),
      ),
      CENTRE,
      'wikidata',
    );

    expect(places.map((place) => place.id)).toEqual(['Q1']);
    expect(rejected).toBe(2);
  });

  it('rejects a sitelink count that is not a whole number', () => {
    const { places } = parsePlaces(
      response(
        binding('Q1', { sitelinks: { value: '4.5' } }),
        binding('Q2', { sitelinks: { value: 'many' } }),
      ),
      CENTRE,
      'wikidata',
    );

    expect(places).toEqual([]);
  });

  it('only believes a Wikipedia article for the link', () => {
    const { places } = parsePlaces(
      response(
        binding('Q1', { article: { value: 'https://evil.example/wiki/Q1' } }),
        binding('Q2', { article: { value: 'https://en.wikipedia.org/wiki/Place' } }),
      ),
      CENTRE,
      'wikidata',
    );

    expect(places.map((place) => place.id)).toEqual(['Q2']);
  });

  it('treats the literal description "undefined" as no description', () => {
    const { places } = parsePlaces(
      response(binding('Q1', { itemDescription: { value: 'undefined' } })),
      CENTRE,
      'wikidata',
    );

    expect(places[0]?.description).toBeNull();
  });

  it("folds an item's several rows into one place, preferring the more specific class", () => {
    const museum = { class: { value: 'http://www.wikidata.org/entity/Q33506' } };
    const attraction = { class: { value: 'http://www.wikidata.org/entity/Q570116' } };

    for (const rows of [
      [binding('Q1', museum), binding('Q1', attraction)],
      [binding('Q1', attraction), binding('Q1', museum)],
    ]) {
      const { places } = parsePlaces(response(...rows), CENTRE, 'wikidata');
      expect(places).toHaveLength(1);
      expect(places[0]?.kind).toBe('museums');
    }
  });

  it('refuses an envelope that is not a SPARQL result, so a failure is never read as "no places"', () => {
    expect(() => parsePlaces({ results: {} }, CENTRE, 'wikidata')).toThrow();
    expect(() => parsePlaces('<html>', CENTRE, 'wikidata')).toThrow();
  });

  it('reads a point as longitude then latitude, and refuses one off the globe', () => {
    expect(parsePoint('Point(30.69556 36.90812)')).toEqual({
      longitude: 30.69556,
      latitude: 36.90812,
    });
    expect(parsePoint('Point(-0.1 51.5)')).toEqual({ longitude: -0.1, latitude: 51.5 });
    expect(parsePoint('Point(181 0)')).toBeNull();
    expect(parsePoint('Point(0 91)')).toBeNull();
    expect(parsePoint('Point(1)')).toBeNull();
  });

  it('finds the centre in a lookup, and nothing in an empty one', () => {
    expect(parseCentre(response({ coord: { value: 'Point(30.7 36.9)' } }))).toEqual({
      longitude: 30.7,
      latitude: 36.9,
    });
    expect(parseCentre(response())).toBeNull();
    expect(parseCentre('nonsense')).toBeNull();
  });
});

describe('image file names', () => {
  it('takes the file out of a Special:FilePath link, decoded', () => {
    expect(
      imageFileFrom('http://commons.wikimedia.org/wiki/Special:FilePath/Hadrian%27s%20Gate.jpg'),
    ).toBe("Hadrian's Gate.jpg");
  });

  it('gives no image for a type the route would refuse, a traversal, or a missing value', () => {
    const link = (name: string) => `http://commons.wikimedia.org/wiki/Special:FilePath/${name}`;

    expect(imageFileFrom(undefined)).toBeNull();
    expect(imageFileFrom('http://example.com/a.jpg')).toBeNull();
    expect(imageFileFrom(link('Plan.svg'))).toBeNull();
    expect(imageFileFrom(link('Scan.tif'))).toBeNull();
    expect(imageFileFrom(link('..%2Fsecret.jpg'))).toBeNull();
    expect(imageFileFrom(link('a%2Fb.jpg'))).toBeNull();
    expect(imageFileFrom(link('%E0%A4%A.jpg'))).toBeNull();
  });
});

describe('failure', () => {
  const thrown: FetchLike = async () => {
    throw new Error('network down');
  };

  it('is a result, not an exception, when the service cannot be reached', async () => {
    const result = await createWikidataPlacesProvider({ fetchImpl: thrown }).thingsToDo(ANTALYA);

    expect(result.ok).toBe(false);
  });

  it('is a result when the service answers an error, and says it is busy for a 429', async () => {
    const answer =
      (status: number): FetchLike =>
      async () =>
        new Response('slow down', { status });

    const busy = await createWikidataPlacesProvider({ fetchImpl: answer(429) }).thingsToDo(ANTALYA);
    const broken = await createWikidataPlacesProvider({ fetchImpl: answer(500) }).thingsToDo(
      ANTALYA,
    );

    expect(!busy.ok && busy.error.code).toBe('PROVIDER_UNAVAILABLE');
    expect(!broken.ok && broken.error.code).toBe('PROVIDER_ERROR');
  });

  it('is a result when the body is not JSON, or not a SPARQL answer', async () => {
    const reply =
      (body: string): FetchLike =>
      async () =>
        new Response(body, { status: 200 });

    for (const body of ['<html>maintenance</html>', '{"results":{}}']) {
      const result = await createWikidataPlacesProvider({ fetchImpl: reply(body) }).thingsToDo(
        ANTALYA,
      );
      expect(result.ok).toBe(false);
    }
  });

  it('refuses a position that is not on the globe without calling out', async () => {
    const fetchImpl = vi.fn<FetchLike>();
    const result = await createWikidataPlacesProvider({ fetchImpl }).thingsToDo({
      ...ANTALYA,
      position: [30, 91],
    });

    expect(result.ok).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('answers the rated-venue search with an honest empty list', async () => {
    const result = await antalya().searchPlaces({ destination: 'AYT', categories: ['restaurant'] });

    expect(result).toEqual({ ok: true, value: [] });
  });
});

describe('what it declares', () => {
  it('is a real, keyless source with a rate limit far under the service allowance', () => {
    const { metadata } = antalya();

    expect(metadata).toMatchObject({ id: 'wikidata', kind: 'places', isMock: false, mode: 'live' });
    expect(metadata.rateLimitPerMinute).toBeGreaterThan(0);
    expect(metadata.rateLimitPerMinute).toBeLessThanOrEqual(30);
  });
});
