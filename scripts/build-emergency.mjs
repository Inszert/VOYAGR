#!/usr/bin/env node
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Build the emergency-number reference data the trip hub shows per country.
 *
 * Source: Wikidata (https://www.wikidata.org), property P2852 "emergency phone
 * number" on country items, with the dialable number read from each number
 * item's P1329 "phone number". Wikidata's structured data is CC0 - no
 * attribution is required, but the page names it anyway, because a safety
 * number is worth knowing where it came from.
 *
 * What is deliberately NOT taken: which service a number reaches. Wikidata's
 * service qualifiers on these items are inconsistent (a Japanese number item
 * is tagged with an Italian service), and a wrong "this is the ambulance"
 * label is worse than none. The data is "numbers Wikidata lists as emergency
 * numbers for this country", and the page says exactly that.
 *
 * Failure behaviour: if the fetch fails or returns nothing usable the script
 * exits non-zero and writes NOTHING. The loader treats a missing file as "no
 * data for any country", which the UI shows as "No verified number on file".
 * A stale or half-written file is never produced, and nothing is guessed.
 *
 * Output: `src/trip-hub/emergency.generated.json`, which is committed. Never
 * hand-edit it; change this script and rerun it (`npm run build:emergency`).
 */

const ENDPOINT = 'https://query.wikidata.org/sparql';
const OUTPUT_FILE = join('src', 'trip-hub', 'emergency.generated.json');

const QUERY = `
SELECT ?iso ?phone WHERE {
  ?country wdt:P31 wd:Q6256; wdt:P297 ?iso.
  ?country wdt:P2852 ?number.
  ?number wdt:P1329 ?phone.
}`;

/** Digits, with an optional leading + and the separators Wikidata uses. */
const DIALABLE = /^\+?[0-9][0-9 -]{1,18}[0-9]$|^[0-9]{2,4}$/;

async function fetchRows() {
  const url = `${ENDPOINT}?format=json&query=${encodeURIComponent(QUERY)}`;
  const response = await fetch(url, {
    headers: {
      // A generic client name, as the Wikimedia user-agent policy asks for something identifying the tool.
      'User-Agent': 'voyagr-build-emergency/1.0 (build script)',
      Accept: 'application/sparql-results+json',
    },
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) throw new Error(`Wikidata answered ${response.status}`);
  const body = await response.json();
  return body.results.bindings;
}

function build(rows) {
  const byCountry = new Map();
  let dropped = 0;

  for (const row of rows) {
    const iso = row.iso?.value;
    const phone = row.phone?.value?.trim();
    if (!iso || !/^[A-Z]{2}$/.test(iso) || !phone || !DIALABLE.test(phone)) {
      dropped += 1;
      continue;
    }
    if (!byCountry.has(iso)) byCountry.set(iso, new Set());
    byCountry.get(iso).add(phone);
  }

  const countries = {};
  for (const iso of [...byCountry.keys()].sort()) {
    countries[iso] = { numbers: [...byCountry.get(iso)].sort() };
  }
  return { countries, dropped };
}

try {
  const rows = await fetchRows();
  const { countries, dropped } = build(rows);
  const count = Object.keys(countries).length;

  // Fewer than this means the query broke, not that the world lost its numbers.
  if (count < 100) throw new Error(`Only ${count} countries came back; refusing to write`);

  const output = {
    source: {
      name: 'Wikidata',
      url: 'https://www.wikidata.org/wiki/Property:P2852',
      property: 'P2852 (emergency phone number), numbers read from P1329 (phone number)',
      license: 'CC0 1.0',
      retrievedOn: new Date().toISOString().slice(0, 10),
    },
    countries,
  };

  await writeFile(OUTPUT_FILE, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
  console.log(`Wrote ${count} countries (${dropped} unusable rows dropped) to ${OUTPUT_FILE}`);
} catch (error) {
  console.error(`build-emergency failed, nothing written: ${error.message}`);
  process.exit(1);
}
