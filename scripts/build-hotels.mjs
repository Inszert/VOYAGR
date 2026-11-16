#!/usr/bin/env node
/**
 * Build the hotel listing the stays page shows: a static extract from
 * OpenStreetMap, never a runtime call.
 *
 * `docs/provider-policy.md` rejects calling the public Overpass endpoint from
 * the production backend and accepts a build-time extract. This is that
 * extract: one polite run, here, that asks Overpass once per city for what
 * mappers tagged as `tourism=hotel|guest_house|hostel|apartment` inside the
 * city's box, keeps the name, the point, and the stars, address and website
 * where they were tagged, and writes one generated file the app reads.
 *
 * Which cities: the place catalogue's first tier with a population of at least
 * 1.5 million (`public/geo/label-places.v1.json`), plus the product's own
 * fixture destinations. A city outside the extract shows the partner card and
 * no pins - the page never asks the network for it.
 *
 * Etiquette: one request at a time, a pause between requests, a descriptive
 * User-Agent, a back-off on 429/502/503/504, and every answer cached in the
 * git-ignored `.hotels-cache/` so a rerun only asks for what is missing.
 *
 * Licence: (c) OpenStreetMap contributors, Open Database License. The file
 * records its source, licence and retrieval date, and the stays page shows the
 * credit. The extract is a derived database under ODbL: if it is ever offered
 * for download it must be offered under ODbL too.
 *
 * Output: `src/providers/stays/hotels.v1.generated.json`. Never hand-edit it;
 * change this script and rerun it:
 *
 *   npx tsx scripts/build-hotels.mjs               # fetch what is missing, then write
 *   npx tsx scripts/build-hotels.mjs --from-cache  # write from the cache only
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { buildListingQuery, parseListingResponse } from '../src/providers/stays/osm-extract.ts';
import { areaAround, distanceFromCentre } from '../src/core/stay/listing.ts';

const ENDPOINT = 'https://overpass-api.de/api/interpreter';
const USER_AGENT = 'Voyagr/1.0 (https://www.voyagrfind.com; one-off hotel extract)';
const CACHE_DIR = '.hotels-cache';
const OUTPUT_FILE = join('src', 'providers', 'stays', 'hotels.v1.generated.json');

/** Kept in step with `LISTING_RADIUS_KM` in `src/providers/stays/listings.ts`. */
const RADIUS_KM = 6;
const MIN_POPULATION = 1_500_000;
/** Per city: enough for a full map, small enough to ship. */
const KEEP_PER_CITY = 120;
const PAUSE_MS = 4_000;
const BACKOFF_MS = 30_000;

/** Write the file from what is already cached, asking the network for nothing. */
const FROM_CACHE = process.argv.includes('--from-cache');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function cities() {
  const catalogue = JSON.parse(await readFile('public/geo/label-places.v1.json', 'utf8')).rows;
  const fixtures = (await readFile('src/providers/fixtures/destinations.ts', 'utf8'))
    .match(/airport: '([A-Z]{3})'/g)
    .map((match) => match.slice(10, 13));

  const chosen = new Map();
  for (const row of catalogue) {
    const [code, city, country, lon, lat, population, tier] = row;
    if ((tier === 1 && population >= MIN_POPULATION) || fixtures.includes(code)) {
      chosen.set(code, { code, city, country, lon, lat });
    }
  }

  const missing = fixtures.filter((code) => !chosen.has(code));
  if (missing.length) {
    console.log(
      `not in the catalogue by code (served by another airport there): ${missing.join(', ')}`,
    );
  }
  return [...chosen.values()];
}

async function ask(place, area) {
  const cached = join(CACHE_DIR, `${place.code}.json`);
  if (existsSync(cached))
    return { body: JSON.parse(await readFile(cached, 'utf8')), fetched: false };
  if (FROM_CACHE) throw new Error('not fetched yet');

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ data: buildListingQuery(area) }).toString(),
      signal: AbortSignal.timeout(60_000),
    }).catch((error) => ({ ok: false, status: 0, error }));

    if (response.ok) {
      const body = await response.json();
      await writeFile(cached, JSON.stringify(body));
      return { body, fetched: true };
    }

    if ([0, 429, 502, 503, 504].includes(response.status) && attempt < 3) {
      console.log(`  ${place.code}: ${response.status}, waiting ${BACKOFF_MS / 1000}s`);
      await sleep(BACKOFF_MS * attempt);
      continue;
    }
    throw new Error(`Overpass answered ${response.status} for ${place.code}`);
  }
  throw new Error(`no answer for ${place.code}`);
}

async function main() {
  await mkdir(CACHE_DIR, { recursive: true });
  const places = await cities();
  console.log(`${places.length} cities`);

  const out = {};
  const failed = [];
  let fetchedAny = false;

  for (const [index, place] of places.entries()) {
    const centre = { latitude: place.lat, longitude: place.lon };
    const area = areaAround(centre, RADIUS_KM);

    try {
      if (fetchedAny) await sleep(PAUSE_MS);
      const { body, fetched } = await ask(place, area);
      fetchedAny = fetched;

      const parsed = parseListingResponse(body);
      if (!parsed) throw new Error('unexpected shape');

      // Tagged with stars or a website first (the mapped detail a row can show), then nearest.
      const kept = parsed.listings
        .map((listing) => ({ listing, metres: distanceFromCentre(centre, listing) }))
        .sort(
          (a, b) =>
            (b.listing.stars !== null) +
              (b.listing.website !== null) -
              ((a.listing.stars !== null) + (a.listing.website !== null)) || a.metres - b.metres,
        )
        .slice(0, KEEP_PER_CITY)
        .map(({ listing }) => [
          listing.id,
          listing.name,
          listing.kind,
          Math.round(listing.latitude * 1e5) / 1e5,
          Math.round(listing.longitude * 1e5) / 1e5,
          listing.stars,
          listing.address,
          listing.website,
        ]);

      if (kept.length) {
        out[place.code] = {
          city: place.city,
          country: place.country,
          centre: [place.lon, place.lat],
          hotels: kept,
        };
      }
      console.log(`${index + 1}/${places.length} ${place.code} ${place.city}: ${kept.length}`);
    } catch (error) {
      failed.push(`${place.code} (${error.message})`);
      console.log(`${index + 1}/${places.length} ${place.code}: FAILED ${error.message}`);
    }
  }

  const file = {
    source: 'OpenStreetMap via the Overpass API (overpass-api.de), one build-time extract',
    licence: 'Open Database License (ODbL) 1.0',
    attribution: '© OpenStreetMap contributors',
    retrievedAt: new Date().toISOString().slice(0, 10),
    radiusKm: RADIUS_KM,
    columns: ['id', 'name', 'kind', 'lat', 'lon', 'stars', 'address', 'website'],
    cities: Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b))),
  };

  await writeFile(OUTPUT_FILE, `${JSON.stringify(file)}\n`);
  const count = Object.values(out).reduce((sum, city) => sum + city.hotels.length, 0);
  console.log(`wrote ${OUTPUT_FILE}: ${Object.keys(out).length} cities, ${count} places`);
  if (failed.length) {
    console.log(`failed: ${failed.join(', ')}`);
    process.exitCode = 1;
  }
}

await main();
