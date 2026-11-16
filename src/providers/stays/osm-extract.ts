import { z } from 'zod';
import type { StayArea } from '../../core/stay/listing';
import { stayListingSchema, validateOffers, type ValidatedStayListing } from '../schema';

/**
 * Hotels from OpenStreetMap, as a build-time extract - never a runtime call.
 *
 * `docs/provider-policy.md` rejects calling the public Overpass endpoint from
 * the production backend (its fair-use guidance rules out production
 * traffic) and accepts a static extract. So this module is only the two halves
 * `scripts/build-hotels.mjs` needs: the query for one city's box, and the
 * parsing of an answer into listings that pass `stayListingSchema`. The app
 * reads the generated file the script writes and nothing else.
 *
 * What a listing holds is what the map's volunteers recorded as
 * `tourism=hotel`, `guest_house`, `hostel` or `apartment`: a name, a point,
 * and stars, an address and a website only where somebody tagged them. **It
 * carries no price and none may be derived from it.** Data (c) OpenStreetMap
 * contributors, ODbL.
 *
 * The script runs this file under tsx, outside Next.
 */

export const OSM_LISTINGS_ID = 'osm-stays';

const SERVER_TIMEOUT_S = 25;

/** Enough for a dense centre; the map clusters them. */
export const MAX_LISTINGS = 300;

const KINDS = ['hotel', 'guest_house', 'hostel', 'apartment'] as const;

/** The query for one box. Numbers only go into it, and they are checked first. */
export function buildListingQuery(area: StayArea): string {
  const edges = [area.south, area.west, area.north, area.east];
  if (!edges.every((value) => Number.isFinite(value))) {
    throw new RangeError('a listing area needs four finite edges');
  }
  if (area.south >= area.north || area.west >= area.east) {
    throw new RangeError('a listing area must have its south below its north and west of east');
  }

  const box = edges.join(',');
  return `[out:json][timeout:${SERVER_TIMEOUT_S}];nwr["tourism"~"^(${KINDS.join('|')})$"]["name"](${box});out center tags ${MAX_LISTINGS};`;
}

// --- Response parsing ------------------------------------------------------

/** The envelope. A response that is not this shape is a failure, not an empty list. */
const envelopeSchema = z
  .object({
    elements: z.array(
      z
        .object({
          type: z.string(),
          id: z.number(),
          lat: z.number().optional(),
          lon: z.number().optional(),
          center: z.object({ lat: z.number(), lon: z.number() }).optional(),
          tags: z.record(z.string(), z.string()).optional(),
        })
        .passthrough(),
    ),
  })
  .passthrough();

type Element = z.infer<typeof envelopeSchema>['elements'][number];

/** "4", "4.5" and "4S" are all mapped; anything else is not a star rating. */
function starsOf(raw: string | undefined): number | null {
  const match = raw?.trim().match(/^([1-5](?:\.5)?)\s*S?$/i);
  return match ? Number(match[1]) : null;
}

function addressOf(tags: Record<string, string>): string | null {
  const street = [tags['addr:street'], tags['addr:housenumber']].filter(Boolean).join(' ');
  const parts = [street, tags['addr:postcode'], tags['addr:city']].filter((part): part is string =>
    Boolean(part && part.trim()),
  );
  return parts.length ? parts.join(', ') : null;
}

function websiteOf(tags: Record<string, string>): string | null {
  const raw = (tags.website ?? tags['contact:website'] ?? '').trim();
  if (!raw) return null;
  // Mappers often leave the scheme off. Anything that is not then a plain
  // http(s) URL is dropped, never put in an href.
  const candidate = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    const url = new URL(candidate);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

/**
 * One element, as a listing candidate - before validation.
 *
 * Every fact the map does not state is an explicit `null`; a field that is
 * merely missing would fail the schema, which is the point.
 */
export function toListing(element: Element): Record<string, unknown> {
  const tags = element.tags ?? {};
  const latitude = element.lat ?? element.center?.lat;
  const longitude = element.lon ?? element.center?.lon;

  return {
    id: `osm:${element.type}/${element.id}`,
    providerId: OSM_LISTINGS_ID,
    name: tags['name:en'] ?? tags.name,
    kind: tags.tourism,
    latitude,
    longitude,
    stars: starsOf(tags.stars),
    address: addressOf(tags),
    website: websiteOf(tags),
  };
}

/** Parse a whole response body. Exported for the recorded-response tests. */
export function parseListingResponse(body: unknown): {
  readonly listings: ValidatedStayListing[];
  readonly rejected: number;
} | null {
  const envelope = envelopeSchema.safeParse(body);
  if (!envelope.success) return null;

  const { accepted, rejected } = validateOffers(
    stayListingSchema,
    envelope.data.elements.map(toListing),
  );

  // One element per hotel: a node and the building drawn round it are often both tagged.
  const seen = new Set<string>();
  const listings = accepted.filter((listing) => {
    const key = `${listing.name.toLowerCase()}:${listing.latitude.toFixed(3)}:${listing.longitude.toFixed(3)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return { listings, rejected: rejected.length };
}
