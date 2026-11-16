/**
 * Record the one-way answers a trip of two single tickets is built from.
 *
 *   node --env-file-if-exists=.env scripts/record-one-way.mjs VIE KZN 2026-11 2026-12
 *
 * Run by hand, once. Asks `prices_for_dates` with `one_way=true` for each
 * month, in both directions, prints how many days each covers, and writes
 * the exchanges **redacted** to `tests/fixtures/providers/aviasales-one-way-<a>-<b>.json`.
 * The token is read from the environment and never printed or written.
 */

import { writeFileSync } from 'node:fs';

const token = process.env.AVIASALES_API_TOKEN;
if (!token) {
  console.error('AVIASALES_API_TOKEN is not set. Nothing recorded.');
  process.exit(1);
}

const [a = 'VIE', b = 'KZN', ...months] = process.argv.slice(2);
const SECRET = /^(token|marker)$/i;
const redact = (url) => {
  const parsed = new URL(url);
  for (const key of [...parsed.searchParams.keys()]) {
    if (SECRET.test(key)) parsed.searchParams.set(key, '[redacted]');
  }
  return parsed.toString();
};

const exchanges = [];
for (const month of months) {
  for (const [origin, destination] of [
    [a, b],
    [b, a],
  ]) {
    const url = new URL('https://api.travelpayouts.com/aviasales/v3/prices_for_dates');
    url.searchParams.set('origin', origin);
    url.searchParams.set('destination', destination);
    url.searchParams.set('departure_at', month);
    url.searchParams.set('one_way', 'true');
    url.searchParams.set('currency', 'eur');
    url.searchParams.set('unique', 'false');
    url.searchParams.set('sorting', 'price');
    url.searchParams.set('limit', '1000');
    url.searchParams.set('direct', 'false');
    url.searchParams.set('token', token);

    const response = await fetch(url, { headers: { Accept: 'application/json' } });
    const body = await response.text();
    let days = 0;
    try {
      const rows = JSON.parse(body).data ?? [];
      days = new Set(rows.map((row) => String(row.departure_at).slice(0, 10))).size;
    } catch {
      days = -1;
    }
    console.log(`${origin}->${destination} ${month}: HTTP ${response.status}, ${days} days`);

    exchanges.push({
      request: {
        method: 'GET',
        url: redact(url.toString()),
        headers: { accept: 'application/json' },
        body: null,
      },
      response: {
        status: response.status,
        statusText: response.statusText,
        headers: { 'content-type': response.headers.get('content-type') ?? '' },
        body,
      },
      recordedAt: new Date().toISOString(),
      note: `one-way ${origin}->${destination} ${month}`,
    });
  }
}

const name = `aviasales-one-way-${a.toLowerCase()}-${b.toLowerCase()}`;
writeFileSync(
  `tests/fixtures/providers/${name}.json`,
  `${JSON.stringify({ name, provider: 'aviasales', exchanges }, null, 2)}\n`,
);
console.log(`recorded tests/fixtures/providers/${name}.json`);
