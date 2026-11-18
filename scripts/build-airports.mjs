#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Build the airport catalogue: every airport with an IATA code and scheduled
 * passenger service, with its size.
 *
 * Source: OurAirports airports.csv (https://ourairports.com/data/), public
 * domain (ODC-PDDL, no attribution required). Reference data only: who
 * exists, where, and how big. It carries no price and no schedule.
 *
 * Kept: a 3-letter IATA code, type large_airport / medium_airport /
 * small_airport (heliports, seaplane bases and closed fields are dropped) and
 * scheduled_service = yes. The last condition is deliberate: it is what makes
 * a country "have an airport" we can price, and it keeps the bundle small. It
 * still covers every country OurAirports lists with scheduled service.
 *
 * Output: src/providers/fixtures/airports.generated.json, an array sorted by
 * iata so the file is byte-stable. Never hand-edit it; rerun this script.
 * The download is cached in .airports-cache/ (not committed). If the network
 * blocks the download the script fails and writes nothing.
 */

const SOURCE_URL = 'https://davidmegginson.github.io/ourairports-data/airports.csv';
const CACHE_DIR = '.airports-cache';
const CACHE_FILE = join(CACHE_DIR, 'airports.csv');
const SIZES = { large_airport: 'large', medium_airport: 'medium', small_airport: 'small' };
const COUNTRY_NAMES = new Map(
  JSON.parse(readFileSync(join('src', 'discovery', 'countries.generated.json'), 'utf8')).map(
    (c) => [c.iso2, c.name],
  ),
);
const FALLBACK_NAMES = new Intl.DisplayNames(['en'], { type: 'region' });

const OUTPUT_FILE = join('src', 'providers', 'fixtures', 'airports.generated.json');

/**
 * Minimal RFC4180 CSV line splitter.
 *
 * OurAirports quotes every field and doubles an embedded quote (`""`), and a
 * few `name`/`keywords` values contain literal commas - `split(',')` would
 * silently misalign every column after one. This is the one thing a CSV
 * parser has to get right; nothing else about the format needs a library.
 */
function parseCsvLine(line) {
  const fields = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];

    if (inQuotes) {
      if (char === '"') {
        if (line[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === ',') {
      fields.push(field);
      field = '';
    } else {
      field += char;
    }
  }

  fields.push(field);
  return fields;
}

async function downloadCsv() {
  if (existsSync(CACHE_FILE)) {
    console.log(`Using cached download: ${CACHE_FILE}`);
    return readFile(CACHE_FILE, 'utf8');
  }

  console.log(`Fetching ${SOURCE_URL} ...`);
  const response = await fetch(SOURCE_URL);
  if (!response.ok) {
    throw new Error(`OurAirports fetch failed: ${response.status} ${response.statusText}`);
  }

  const text = await response.text();
  await mkdir(CACHE_DIR, { recursive: true });
  await writeFile(CACHE_FILE, text, 'utf8');
  return text;
}

function buildIndex(csvText) {
  const lines = csvText.split(/\r?\n/).filter((line) => line.length > 0);
  const header = parseCsvLine(lines[0]);

  const col = Object.fromEntries(header.map((name, index) => [name, index]));
  for (const required of [
    'iata_code',
    'ident',
    'scheduled_service',
    'name',
    'latitude_deg',
    'longitude_deg',
    'municipality',
    'iso_country',
    'type',
  ]) {
    if (!(required in col)) {
      throw new Error(`OurAirports CSV is missing an expected column: ${required}`);
    }
  }

  const byIata = {};
  let scanned = 0;
  let duplicates = 0;

  for (let i = 1; i < lines.length; i += 1) {
    const fields = parseCsvLine(lines[i]);
    const iata = fields[col.iata_code];
    const scheduled = fields[col.scheduled_service];
    const size = SIZES[fields[col.type]];
    if (!iata || !/^[A-Z]{3}$/.test(iata) || scheduled !== 'yes' || !size) continue;

    scanned += 1;

    const lat = Number.parseFloat(fields[col.latitude_deg]);
    const lon = Number.parseFloat(fields[col.longitude_deg]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;

    if (byIata[iata]) {
      // A handful of IATA codes are shared by more than one row in the raw
      // data (reassigned codes, or a heliport and an airport at the same
      // code). First scheduled-service match wins; this is rare enough that
      // the count is worth printing rather than silently picking one.
      duplicates += 1;
      continue;
    }

    const ident = fields[col.ident];
    const country = fields[col.iso_country];
    byIata[iata] = {
      iata,
      icao: /^[A-Z0-9]{4}$/.test(ident) ? ident : null,
      name: fields[col.name],
      city: fields[col.municipality] || null,
      country,
      countryName: COUNTRY_NAMES.get(country) ?? (country ? FALLBACK_NAMES.of(country) : null),
      latitude: Math.round(lat * 1e5) / 1e5,
      longitude: Math.round(lon * 1e5) / 1e5,
      type: size,
    };
  }

  console.log(`Scanned ${scanned} scheduled-service rows with an IATA code.`);
  console.log(`Kept ${Object.keys(byIata).length} unique codes (${duplicates} duplicate skipped).`);

  return byIata;
}

async function main() {
  const csvText = await downloadCsv();
  const index = buildIndex(csvText);

  const sorted = Object.keys(index)
    .sort()
    .map((code) => index[code]);
  const countries = new Set(sorted.map((a) => a.country)).size;
  console.log(`${sorted.length} airports in ${countries} countries.`);

  await mkdir(join('src', 'providers', 'fixtures'), { recursive: true });
  await writeFile(OUTPUT_FILE, `${JSON.stringify(sorted)}\n`, 'utf8');
  console.log(`Wrote ${OUTPUT_FILE}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
