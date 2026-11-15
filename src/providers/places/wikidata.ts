import { z } from 'zod';
import { distanceMetres, type Coordinates } from '@/core/distance';
import { AppError } from '@/lib/errors';
import { getLogger } from '@/lib/logger';
import { err, ok } from '@/lib/result';
import type { FetchLike } from '../http/types';
import { COMMONS_FILE_NAME, thingToDoSchema, validateOffers } from '../schema';
import type {
  Place,
  PlacesProvider,
  PlacesQuery,
  ProviderHealth,
  ProviderRequestOptions,
  ProviderResult,
  ThingKind,
  ThingToDo,
  ThingsToDoQuery,
} from '../types';

/**
 * Things to see and do, from Wikidata.
 *
 * Wikidata is the free, open knowledge base behind Wikipedia; its data is CC0
 * (public domain), so there is nothing to attribute and nothing to licence, and
 * the sourcing line on the page names it anyway. Every place this returns is an
 * item somebody curated, with coordinates, a label in English and a count of
 * how many Wikipedia editions cover it. Nothing is generated.
 *
 * **Notability is a count, not an opinion.** Places are ranked by their number
 * of sitelinks - how many language editions of Wikipedia have an article
 * about them. It is public, deterministic and the same on every machine, and
 * it says nothing about quality, so nothing here is called a rating.
 *
 * **What this slot does not carry.** Wikidata has no restaurants, prices or
 * reviews, so `searchPlaces` (the rated-venues shape) answers an honest empty
 * list and the page's "cannot tell you yet" note keeps naming what is missing.
 *
 * **The centre is the city's, not the airport's.** A destination is held as
 * its airport, which can be a long way out of town, and "2 km from the centre"
 * measured from a runway is a false claim. So the city's own item is looked up
 * first (same label, a settlement, within 60 km of the airport) and the
 * radius is drawn around that; if the lookup finds nothing the airport's
 * position is used, and the distances are measured from it.
 *
 * Query service etiquette (https://www.mediawiki.org/wiki/Wikidata_Query_Service/User_Manual):
 * a descriptive User-Agent, one query at a time, and the answer cached for days
 * by the caller. The declared rate limit is far below the service's own.
 */

const log = getLogger('providers.wikidata');

const ENDPOINT = 'https://query.wikidata.org/sparql';

/** Names the app and where to read about it. A URL, never a person's address. */
const USER_AGENT = 'Voyagr/1.0 (https://www.voyagrfind.com)';

/** Wikidata's own query limit is 60 seconds; there is no point asking for longer. */
const DEFAULT_TIMEOUT_MS = 55_000;

/** The first radius, and the one used when it finds enough. */
export const NEAR_RADIUS_KM = 15;
/** Used when the first radius finds fewer than {@link ENOUGH_PLACES}. */
export const WIDE_RADIUS_KM = 30;
export const ENOUGH_PLACES = 10;

/** How far from the airport the city's own item may be. */
const CENTRE_SEARCH_KM = 60;

/** An item known to fewer editions than this is not notable enough to list. */
const MIN_SITELINKS = 2;

const DEFAULT_RESULTS = 60;
const MAX_RESULTS = 100;
const QUERY_ROW_LIMIT = 250;

/**
 * Wikidata classes, in the order they decide a place's group.
 *
 * A place is often several things at once - a mosque that is also a tourist
 * attraction - and the more specific class wins, which is why the generic
 * "tourist attraction" and "monument" come last. Each class is matched with its
 * subclasses, so "archaeological museum" is a museum.
 *
 * Plain neighbourhoods and quarters are left out on purpose: in Wikidata they
 * are mostly administrative units (a mahalle is a line on a municipal map, not
 * somewhere to go) and cannot be told apart cheaply. Historic districts stay.
 *
 * The query is written to run in this order (`optimizer "None"`): first the
 * circle and the sitelink floor, which leaves a few hundred items even in
 * Lisbon, and only then the class check. Left to its own planner the service
 * checks every item in the circle against the class tree first and times out
 * (60 s) for a dense city; written this way Lisbon answers in about 30 s and
 * Antalya in about 12 s.
 */
const CLASSES: readonly { readonly id: string; readonly kind: ThingKind }[] = [
  { id: 'Q33506', kind: 'museums' }, // museum
  { id: 'Q330284', kind: 'food' }, // marketplace
  { id: 'Q40080', kind: 'outdoors' }, // beach
  { id: 'Q22698', kind: 'outdoors' }, // park
  { id: 'Q1107656', kind: 'outdoors' }, // garden
  { id: 'Q6017969', kind: 'outdoors' }, // scenic viewpoint
  { id: 'Q34038', kind: 'outdoors' }, // waterfall
  { id: 'Q35509', kind: 'outdoors' }, // cave
  { id: 'Q24354', kind: 'culture' }, // theatre building
  { id: 'Q153562', kind: 'culture' }, // opera house
  { id: 'Q1060829', kind: 'culture' }, // concert hall
  { id: 'Q1329623', kind: 'culture' }, // cultural center
  { id: 'Q15243209', kind: 'neighbourhoods' }, // historic district
  { id: 'Q2977', kind: 'sights' }, // cathedral
  { id: 'Q32815', kind: 'sights' }, // mosque
  { id: 'Q16970', kind: 'sights' }, // church building
  { id: 'Q34627', kind: 'sights' }, // synagogue
  { id: 'Q44539', kind: 'sights' }, // temple
  { id: 'Q108325', kind: 'sights' }, // chapel
  { id: 'Q160742', kind: 'sights' }, // abbey
  { id: 'Q23413', kind: 'sights' }, // castle
  { id: 'Q16560', kind: 'sights' }, // palace
  { id: 'Q839954', kind: 'sights' }, // archaeological site
  { id: 'Q1081138', kind: 'sights' }, // historic site
  { id: 'Q4989906', kind: 'sights' }, // monument
  { id: 'Q570116', kind: 'sights' }, // tourist attraction
];

const KIND_BY_CLASS = new Map(CLASSES.map((entry, index) => [entry.id, { ...entry, index }]));

/** Wikidata item ids are interpolated into a query, so they are checked, not trusted. */
const ITEM_ID = /^Q[1-9]\d{0,12}$/;

// --- Queries ---------------------------------------------------------------

function sparqlString(value: string): string {
  // Control characters have no business in a place name and are how a literal
  // gets broken out of; refuse rather than escape them.
  if (/[\u0000-\u001f\u007f]/.test(value)) {
    throw new RangeError('a SPARQL string literal cannot hold control characters');
  }

  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function point(position: readonly [number, number]): string {
  const [longitude, latitude] = position;
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) {
    throw new RangeError('a position needs finite coordinates');
  }

  return `"Point(${longitude} ${latitude})"^^geo:wktLiteral`;
}

/** The city's own item: same English label, a settlement, nearest the airport. */
export function buildCentreQuery(name: string, near: readonly [number, number]): string {
  return `SELECT ?item ?coord ?sitelinks WHERE {
  SERVICE wikibase:around {
    ?item wdt:P625 ?coord .
    bd:serviceParam wikibase:center ${point(near)} .
    bd:serviceParam wikibase:radius "${CENTRE_SEARCH_KM}" .
  }
  ?item wdt:P31/wdt:P279* wd:Q486972 .
  ?item rdfs:label ${sparqlString(name)}@en .
  ?item wikibase:sitelinks ?sitelinks .
}
ORDER BY DESC(?sitelinks) LIMIT 1`;
}

/** Notable things inside a radius, one row per class, image and article an item has. */
export function buildPlacesQuery(centre: readonly [number, number], radiusKm: number): string {
  if (!Number.isFinite(radiusKm) || radiusKm <= 0 || radiusKm > 100) {
    throw new RangeError('radiusKm must be between 0 and 100');
  }

  const classes = CLASSES.map((entry) => `wd:${entry.id}`).join(' ');

  return `SELECT ?item ?itemLabel ?itemDescription ?coord ?sitelinks ?class ?image ?article WHERE {
  hint:Query hint:optimizer "None" .
  {
    SELECT ?item ?coord ?sitelinks WHERE {
      SERVICE wikibase:around {
        ?item wdt:P625 ?coord .
        bd:serviceParam wikibase:center ${point(centre)} .
        bd:serviceParam wikibase:radius "${radiusKm}" .
      }
      ?item wikibase:sitelinks ?sitelinks . FILTER(?sitelinks >= ${MIN_SITELINKS})
    }
  }
  ?item wdt:P31 ?type .
  ?type wdt:P279* ?class .
  VALUES ?class { ${classes} }
  ?item rdfs:label ?itemLabel . FILTER(LANG(?itemLabel) = "en")
  OPTIONAL { ?item schema:description ?itemDescription . FILTER(LANG(?itemDescription) = "en") }
  OPTIONAL { ?item wdt:P18 ?image . }
  OPTIONAL { ?article schema:about ?item ; schema:isPartOf <https://en.wikipedia.org/> . }
}
ORDER BY DESC(?sitelinks) ?item LIMIT ${QUERY_ROW_LIMIT}`;
}

// --- Response parsing ------------------------------------------------------

const term = z.object({ value: z.string() }).passthrough();

/** The envelope. A response that is not this shape is a failure, not an empty answer. */
const envelopeSchema = z.object({
  results: z.object({ bindings: z.array(z.unknown()) }),
});

const rowSchema = z.object({
  item: term,
  itemLabel: term,
  itemDescription: term.optional(),
  coord: term,
  sitelinks: term,
  class: term,
  image: term.optional(),
  article: term.optional(),
});

type Row = z.infer<typeof rowSchema>;

function itemId(uri: string): string | null {
  const id = uri.split('/').pop() ?? '';
  return ITEM_ID.test(id) ? id : null;
}

/** `Point(30.69556 36.90812)` is longitude then latitude. */
export function parsePoint(wkt: string): Coordinates | null {
  const match = /^Point\((-?\d+(?:\.\d+)?(?:e-?\d+)?) (-?\d+(?:\.\d+)?(?:e-?\d+)?)\)$/i.exec(wkt);
  if (!match) return null;

  const longitude = Number(match[1]);
  const latitude = Number(match[2]);

  // A coordinate off the globe is a malformed row, and `distanceMetres` would throw on it.
  return Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180 ? { latitude, longitude } : null;
}

/**
 * The Commons file name inside a `Special:FilePath` link, or null.
 *
 * A name that would not pass the image route's own check is dropped here, so a
 * place with an unusual file (an SVG, a TIFF) shows the neutral tile instead of
 * a broken picture.
 */
export function imageFileFrom(uri: string | undefined): string | null {
  if (!uri) return null;

  const marker = 'Special:FilePath/';
  const at = uri.indexOf(marker);
  if (at === -1) return null;

  let name: string;
  try {
    name = decodeURIComponent(uri.slice(at + marker.length));
  } catch {
    return null;
  }

  return COMMONS_FILE_NAME.test(name) ? name : null;
}

/** Wikidata sometimes holds the literal word "undefined" as a description. */
function descriptionFrom(value: string | undefined): string | null {
  const text = value?.trim();
  if (!text || text.toLowerCase() === 'undefined') return null;

  return text;
}

interface Accumulated {
  readonly id: string;
  readonly row: Row;
  readonly coordinates: Coordinates | null;
  classIndex: number;
  kind: ThingKind | null;
  image: string | null;
  article: string | null;
}

/**
 * Rows to places.
 *
 * The query returns one row per matching class, picture and article, so an item
 * arrives several times. They are folded into one place, and wherever the rows
 * disagree the smallest value wins - the most specific class, the first file
 * name alphabetically - so the same response always yields the same page.
 */
export function parsePlaces(
  response: unknown,
  centre: Coordinates,
  providerId: string,
): { places: ThingToDo[]; rejected: number } {
  const envelope = envelopeSchema.safeParse(response);
  if (!envelope.success) {
    throw new AppError('PROVIDER_ERROR', 'Wikidata returned an unrecognised response.');
  }

  const folded = new Map<string, Accumulated>();
  let rejected = 0;

  for (const binding of envelope.data.results.bindings) {
    const row = rowSchema.safeParse(binding);
    const id = row.success ? itemId(row.data.item.value) : null;
    if (!row.success || id === null) {
      rejected += 1;
      continue;
    }

    const entry =
      folded.get(id) ??
      ({
        id,
        row: row.data,
        coordinates: parsePoint(row.data.coord.value),
        classIndex: Number.POSITIVE_INFINITY,
        kind: null,
        image: null,
        article: null,
      } satisfies Accumulated);
    folded.set(id, entry);

    const matched = KIND_BY_CLASS.get(itemId(row.data.class.value) ?? '');
    if (matched && matched.index < entry.classIndex) {
      entry.classIndex = matched.index;
      entry.kind = matched.kind;
    }

    const image = imageFileFrom(row.data.image?.value);
    if (image && (entry.image === null || image < entry.image)) entry.image = image;

    const article = row.data.article?.value;
    if (article && (entry.article === null || article < entry.article)) entry.article = article;
  }

  const candidates = [...folded.values()].map((entry) => {
    const label = entry.row.itemLabel.value.trim();
    const sitelinks = Number(entry.row.sitelinks.value);

    return {
      id: entry.id,
      providerId,
      name: label,
      // An item that matched no class cannot be sorted into a group; null fails
      // the schema below and is counted as rejected.
      kind: entry.kind,
      description: descriptionFrom(entry.row.itemDescription?.value),
      latitude: entry.coordinates?.latitude ?? Number.NaN,
      longitude: entry.coordinates?.longitude ?? Number.NaN,
      distanceFromCentreMetres: entry.coordinates ? distanceMetres(centre, entry.coordinates) : -1,
      notability: Number.isInteger(sitelinks) ? sitelinks : -1,
      wikipediaUrl: entry.article,
      imageFile: entry.image,
    };
  });

  const checked = validateOffers(thingToDoSchema, candidates);
  rejected += checked.rejected.length;

  // A label that is only an item id is Wikidata's "no label" fallback, which is
  // a missing English label wearing a name.
  const places = checked.accepted
    .filter((place) => !/^Q\d+$/.test(place.name))
    .sort(
      (a, b) =>
        b.notability - a.notability ||
        a.distanceFromCentreMetres - b.distanceFromCentreMetres ||
        a.id.localeCompare(b.id, 'en'),
    );

  rejected += checked.accepted.length - places.length;

  return { places, rejected };
}

/** The first row of a centre lookup, as a point, or null when nothing matched. */
export function parseCentre(response: unknown): Coordinates | null {
  const envelope = envelopeSchema.safeParse(response);
  if (!envelope.success) return null;

  const row = z.object({ coord: term }).safeParse(envelope.data.results.bindings[0]);

  return row.success ? parsePoint(row.data.coord.value) : null;
}

// --- The adapter -----------------------------------------------------------

export interface WikidataOptions {
  readonly fetchImpl?: FetchLike;
  readonly timeoutMs?: number;
}

export class WikidataPlacesProvider implements PlacesProvider {
  readonly metadata = {
    id: 'wikidata',
    kind: 'places',
    displayName: 'Wikidata',
    isMock: false,
    mode: 'live',
    // Far below the service's own allowance: a query here is heavy, the answer
    // is cached for a week, and the service asks for politeness over speed.
    rateLimitPerMinute: 10,
    typicalLatencyMs: 15_000,
  } as const;

  private readonly fetchImpl: FetchLike;
  private readonly timeoutMs: number;

  constructor(options: WikidataOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? ((url, init) => fetch(url, init));
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async checkHealth(options?: ProviderRequestOptions): Promise<ProviderHealth> {
    const startedAt = Date.now();
    const result = await this.query('SELECT ?x WHERE { BIND(1 AS ?x) }', options);

    return result.ok
      ? {
          status: 'healthy',
          checkedAt: new Date().toISOString(),
          latencyMs: Date.now() - startedAt,
        }
      : {
          status: 'unavailable',
          checkedAt: new Date().toISOString(),
          latencyMs: null,
          message: result.error.message,
        };
  }

  /** Wikidata has no venues, prices or ratings; see the module comment. */
  async searchPlaces(
    _query: PlacesQuery,
    _options?: ProviderRequestOptions,
  ): Promise<ProviderResult<readonly Place[]>> {
    return ok([]);
  }

  async thingsToDo(
    query: ThingsToDoQuery,
    options?: ProviderRequestOptions,
  ): Promise<ProviderResult<readonly ThingToDo[]>> {
    const [longitude, latitude] = query.position;
    if (
      !Number.isFinite(longitude) ||
      !Number.isFinite(latitude) ||
      Math.abs(latitude) > 90 ||
      Math.abs(longitude) > 180
    ) {
      return err(
        new AppError('VALIDATION_ERROR', `No usable position for "${query.destination}".`),
      );
    }

    const limit = Math.min(MAX_RESULTS, Math.max(1, query.maxResults ?? DEFAULT_RESULTS));

    try {
      const centre = await this.findCentre(query, options);

      let found = await this.placesWithin(centre, NEAR_RADIUS_KM, options);
      if (!found.ok) return found;

      // A small town has few notable things in 15 km, and a short list is worse
      // than a wider one. The wider answer contains the first, so nothing is lost.
      if (found.value.length < ENOUGH_PLACES) {
        const wider = await this.placesWithin(centre, WIDE_RADIUS_KM, options);
        if (wider.ok && wider.value.length > found.value.length) found = wider;
      }

      return ok(found.value.slice(0, limit));
    } catch (cause) {
      return err(
        cause instanceof AppError
          ? cause
          : new AppError('PROVIDER_ERROR', 'Wikidata places lookup failed.', { cause }),
      );
    }
  }

  private async findCentre(
    query: ThingsToDoQuery,
    options?: ProviderRequestOptions,
  ): Promise<Coordinates> {
    const fallback = { longitude: query.position[0], latitude: query.position[1] };

    let sparql: string;
    try {
      sparql = buildCentreQuery(query.destinationName, query.position);
    } catch {
      return fallback;
    }

    const response = await this.query(sparql, options);
    if (!response.ok) {
      log.warn({ destination: query.destination }, 'city centre lookup failed; using the airport');
      return fallback;
    }

    return parseCentre(response.value) ?? fallback;
  }

  private async placesWithin(
    centre: Coordinates,
    radiusKm: number,
    options?: ProviderRequestOptions,
  ): Promise<ProviderResult<ThingToDo[]>> {
    const response = await this.query(
      buildPlacesQuery([centre.longitude, centre.latitude], radiusKm),
      options,
    );
    if (!response.ok) return response;

    try {
      const { places, rejected } = parsePlaces(response.value, centre, this.metadata.id);
      if (rejected > 0) log.warn({ rejected, radiusKm }, 'wikidata rows dropped at the boundary');

      return ok(places);
    } catch (cause) {
      return err(
        cause instanceof AppError
          ? cause
          : new AppError('PROVIDER_ERROR', 'Wikidata returned an unrecognised response.', {
              cause,
            }),
      );
    }
  }

  private async query(
    sparql: string,
    options?: ProviderRequestOptions,
  ): Promise<ProviderResult<unknown>> {
    const url = `${ENDPOINT}?${new URLSearchParams({ query: sparql, format: 'json' }).toString()}`;
    const timeout = AbortSignal.timeout(options?.timeoutMs ?? this.timeoutMs);
    const signal = options?.signal ? AbortSignal.any([options.signal, timeout]) : timeout;

    try {
      const response = await this.fetchImpl(url, {
        signal,
        headers: { 'User-Agent': USER_AGENT, Accept: 'application/sparql-results+json' },
      });

      if (!response.ok) {
        // 429 and 5xx both mean "not now"; neither is an answer about places.
        return err(
          new AppError(
            response.status === 429 ? 'PROVIDER_UNAVAILABLE' : 'PROVIDER_ERROR',
            `Wikidata responded ${response.status}`,
            { context: { status: response.status } },
          ),
        );
      }

      return ok(await response.json());
    } catch (cause) {
      const timedOut = cause instanceof Error && cause.name === 'TimeoutError';

      return err(
        new AppError(
          timedOut ? 'PROVIDER_TIMEOUT' : 'PROVIDER_UNAVAILABLE',
          'Wikidata could not be reached.',
          { cause },
        ),
      );
    }
  }
}

export function createWikidataPlacesProvider(options: WikidataOptions = {}): PlacesProvider {
  return new WikidataPlacesProvider(options);
}
