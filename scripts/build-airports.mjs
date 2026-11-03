#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Build the airport reference data flights, weather and nearby-airport logic
 * resolve a code against.
 *
 * Source: OurAirports (https://ourairports.com/data/), public domain
 * (ODC-PDDL) - no attribution required, regenerated nightly upstream. This is
 * reference data only: who exists, where it is, whether it has scheduled
 * service. It carries no price and no schedule, and nothing here may be used
 * as one.
 *
 * Kept to airports with `scheduled_service: yes` **and** an IATA code - the
 * set an airline search or a weather lookup could plausibly be asked about.
 * That drops heliports, seaplane bases and the ~90% of the raw file that is
 * small private strips with no commercial relevance; it is a documented
 * narrowing, not a silent one, and the script prints how many rows survived.
 *
 * The download is cached in `.airports-cache/`, which is not committed; the
 * filtered output is `src/providers/reference/airports.generated.json`, which
 * is.
 */

const SOURCE_URL = 'https://davidmegginson.github.io/ourairports-data/airports.csv';
const CACHE_DIR = '.airports-cache';
const CACHE_FILE = join(CACHE_DIR, 'airports.csv');
const OUTPUT_FILE = join('src', 'providers', 'reference', 'airports.generated.json');

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
    if (!iata || !/^[A-Z]{3}$/.test(iata) || scheduled !== 'yes') continue;

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

    byIata[iata] = {
      name: fields[col.name],
      municipality: fields[col.municipality] || null,
      country: fields[col.iso_country] || null,
      type: fields[col.type],
      // GeoJSON order, matching the fixture files this complements.
      position: [Math.round(lon * 1e5) / 1e5, Math.round(lat * 1e5) / 1e5],
    };
  }

  console.log(`Scanned ${scanned} scheduled-service rows with an IATA code.`);
  console.log(`Kept ${Object.keys(byIata).length} unique codes (${duplicates} duplicate skipped).`);

  return byIata;
}

async function main() {
  const csvText = await downloadCsv();
  const index = buildIndex(csvText);

  // A replacer *array* filters keys at every nesting level it is given, not
  // just the top one - passing the sorted IATA codes that way silently strips
  // every inner field too, since none of them happen to match a 3-letter
  // code. Sorting by rebuilding the object in order keeps the nested data
  // intact and still gets a deterministic, diffable key order.
  const sorted = Object.fromEntries(Object.keys(index).sort().map((code) => [code, index[code]]));

  await mkdir(join('src', 'providers', 'reference'), { recursive: true });
  await writeFile(OUTPUT_FILE, `${JSON.stringify(sorted)}\n`, 'utf8');
  console.log(`Wrote ${OUTPUT_FILE}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
