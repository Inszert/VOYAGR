/**
 * Record one real Aviasales exchange, for the test suite to replay forever.
 *
 * Run once, by hand, with credentials in `.env`:
 *
 *   node --experimental-strip-types scripts/record-aviasales.mjs
 *
 * Nothing in the suite runs this. It makes a live call, writes a **redacted**
 * cassette under `tests/fixtures/providers/`, and prints what the vendor
 * actually sent - the shape, the timezone offsets and the rate-limit headers -
 * because those are the three things no amount of reading documentation
 * settles.
 *
 * The token is never printed and never written to the fixture: the URL goes
 * through `redactUrl` and the headers through `redactHeaders` before anything
 * touches the disk.
 */

process.loadEnvFile?.('.env');

const token = process.env.AVIASALES_API_TOKEN;
const marker = process.env.AVIASALES_PARTNER_ID;

if (!token) {
  console.error('AVIASALES_API_TOKEN is not set. Nothing recorded.');
  process.exit(1);
}

const { redactHeaders, redactUrl } = await import('../src/providers/http/redact.ts');
const { saveCassette } = await import('../src/providers/http/cassette.ts');

const url = new URL('https://api.travelpayouts.com/aviasales/v3/prices_for_dates');
const [origin = 'VIE', destination = 'AYT', departAt, returnAt] = process.argv.slice(2);

/*
 * Dates default to a month ahead, not to a fixture's dates.
 *
 * This endpoint serves *cached* prices, so a date in the past returns an
 * empty set with a perfectly healthy 200 - which reads exactly like a broken
 * integration. The first recording attempt hit precisely that.
 */
const plus = (days) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

url.searchParams.set('origin', origin);
url.searchParams.set('destination', destination);
url.searchParams.set('departure_at', departAt ?? plus(30));
url.searchParams.set('return_at', returnAt ?? plus(37));
url.searchParams.set('currency', 'eur');
url.searchParams.set('unique', 'false');
url.searchParams.set('sorting', 'price');
url.searchParams.set('limit', '30');
url.searchParams.set('direct', 'false');
url.searchParams.set('token', token);
if (marker) url.searchParams.set('marker', marker);

console.log('GET', redactUrl(url.toString()));

const started = Date.now();
const response = await fetch(url, { headers: { Accept: 'application/json' } });
const body = await response.text();

console.log(`\nHTTP ${response.status} ${response.statusText} in ${Date.now() - started}ms`);

const headers = Object.fromEntries(response.headers.entries());

console.log('\n--- rate-limit and cache headers as sent ---');
for (const [name, value] of Object.entries(headers)) {
  if (/rate.?limit|retry-after|cache-control|age|expires|x-cache/i.test(name)) {
    console.log(`  ${name}: ${value}`);
  }
}

let parsed;
try {
  parsed = JSON.parse(body);
} catch {
  console.log('\nBody was not JSON. First 300 characters:\n', body.slice(0, 300));
  process.exit(1);
}

console.log('\n--- top-level keys ---');
console.log(' ', Object.keys(parsed).join(', '));

const rows = Array.isArray(parsed.data) ? parsed.data : [];
console.log(`\ndata: ${rows.length} rows`);

if (rows[0]) {
  console.log('\n--- every field on the first row, with its type ---');
  for (const [key, value] of Object.entries(rows[0])) {
    console.log(
      `  ${key.padEnd(22)} ${typeof value === 'object' ? 'object' : typeof value}  ${JSON.stringify(value)}`,
    );
  }

  console.log('\n--- timezone evidence: offsets as sent ---');
  for (const row of rows.slice(0, 5)) {
    console.log(
      `  ${row.origin}->${row.destination}  departure_at=${row.departure_at}  return_at=${row.return_at}`,
    );
  }

  const directCount = rows.filter((r) => r.transfers === 0 && r.return_transfers === 0).length;
  console.log(`\ndirect both ways: ${directCount} of ${rows.length}`);
}

const path = saveCassette({
  name: 'aviasales-prices-for-dates',
  provider: 'aviasales',
  exchanges: [
    {
      request: {
        method: 'GET',
        url: redactUrl(url.toString()),
        headers: redactHeaders({ accept: 'application/json' }),
        body: null,
      },
      response: {
        status: response.status,
        statusText: response.statusText,
        headers: redactHeaders(headers),
        body,
      },
      recordedAt: new Date().toISOString(),
      note: 'VIE->AYT round trip, direct=false, so both direct and connecting rows are present.',
    },
  ],
});

console.log(`\nrecorded to ${path}`);
