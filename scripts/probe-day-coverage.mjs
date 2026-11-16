/**
 * How many days of one month each Travelpayouts Data API endpoint can price.
 *
 * Run by hand, once, with credentials in `.env`:
 *
 *   node --env-file-if-exists=.env --experimental-strip-types scripts/probe-day-coverage.mjs VIE FCO 2026-12
 *
 * Nothing in the suite runs this. It asks each endpoint the calendar can use
 * for one route and one month, prints how many departure days each one
 * covers (return fares and one-way fares counted apart), and records the
 * exchanges **redacted** as a cassette, so the unit tests replay real shapes.
 *
 * The token is read from the environment, sent as the API requires, and never
 * printed or written: URLs go through `redactUrl` and headers through
 * `redactHeaders` before anything reaches the console or the disk.
 */

const token = process.env.AVIASALES_API_TOKEN;

if (!token) {
  console.error('AVIASALES_API_TOKEN is not set. Nothing probed.');
  process.exit(1);
}

const { redactBody, redactHeaders, redactUrl } = await import('../src/providers/http/redact.ts');
const { writeFileSync } = await import('node:fs');

/** The cassette format `src/providers/http/cassette.ts` reads; written here without its `@/` imports. */
function saveCassette(cassette) {
  const path = `tests/fixtures/providers/${cassette.name}.json`;
  writeFileSync(
    path,
    `${JSON.stringify(cassette, null, 2)}
`,
    'utf8',
  );
  return path;
}

const nextMonth = () => {
  const now = new Date();
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return next.toISOString().slice(0, 7);
};

const [origin = 'VIE', destination = 'FCO', month = nextMonth()] = process.argv.slice(2);
const following = (() => {
  const [year, mm] = month.split('-').map(Number);
  const next = new Date(Date.UTC(year, mm, 1));
  return next.toISOString().slice(0, 7);
})();

const BASE = 'https://api.travelpayouts.com';

/** Each endpoint, with the parameters its documentation names. */
const probes = [
  {
    name: 'prices_for_dates (month, return in month)',
    path: '/aviasales/v3/prices_for_dates',
    params: {
      origin,
      destination,
      departure_at: month,
      return_at: month,
      currency: 'eur',
      unique: 'false',
      sorting: 'price',
      limit: '1000',
      direct: 'false',
    },
  },
  {
    name: 'prices_for_dates (month, return next month)',
    path: '/aviasales/v3/prices_for_dates',
    params: {
      origin,
      destination,
      departure_at: month,
      return_at: following,
      currency: 'eur',
      unique: 'false',
      sorting: 'price',
      limit: '1000',
      direct: 'false',
    },
  },
  {
    name: 'prices_for_dates (month, one way)',
    path: '/aviasales/v3/prices_for_dates',
    params: {
      origin,
      destination,
      departure_at: month,
      one_way: 'true',
      currency: 'eur',
      unique: 'false',
      sorting: 'price',
      limit: '1000',
      direct: 'false',
    },
  },
  {
    name: 'grouped_prices (by departure day, round trip)',
    path: '/aviasales/v3/grouped_prices',
    params: {
      origin,
      destination,
      departure_at: month,
      group_by: 'departure_at',
      currency: 'eur',
    },
  },
  {
    name: 'prices/calendar (v1, by departure day)',
    path: '/v1/prices/calendar',
    params: {
      origin,
      destination,
      depart_date: month,
      return_date: month,
      calendar_type: 'departure_date',
      currency: 'eur',
    },
  },
  {
    name: 'prices/month-matrix (v2)',
    path: '/v2/prices/month-matrix',
    params: {
      origin,
      destination,
      month: `${month}-01`,
      currency: 'eur',
      show_to_affiliates: 'true',
    },
  },
  {
    name: 'prices/latest (v2, month)',
    path: '/v2/prices/latest',
    params: {
      origin,
      destination,
      period_type: 'month',
      beginning_of_period: `${month}-01`,
      one_way: 'false',
      currency: 'eur',
      limit: '1000',
      show_to_affiliates: 'true',
      sorting: 'price',
    },
  },
];

/** Every row the endpoint returned, whatever the envelope. */
function rowsOf(body) {
  const data = body?.data;
  if (Array.isArray(data)) return data;
  if (data && typeof data === 'object') {
    // v1 calendar: keyed by day; v1 cheap/direct: keyed by destination then index;
    // v3 grouped_prices: keyed by day.
    return Object.entries(data).flatMap(([key, value]) =>
      value && typeof value === 'object' && !('price' in value) && !('value' in value)
        ? Object.values(value)
        : [{ __key: key, ...value }],
    );
  }
  return [];
}

const day = (value) => (typeof value === 'string' ? value.slice(0, 10) : null);

function departureOf(row) {
  return day(row.departure_at ?? row.depart_date ?? row.__key);
}

function returnOf(row) {
  const value = row.return_at ?? row.return_date;
  return typeof value === 'string' && value.length >= 10 ? value.slice(0, 10) : null;
}

const exchanges = [];
const summary = [];

for (const probe of probes) {
  const url = new URL(probe.path, BASE);
  for (const [key, value] of Object.entries(probe.params)) url.searchParams.set(key, value);
  url.searchParams.set('token', token);

  const response = await fetch(url, { headers: { Accept: 'application/json' } });
  const text = await response.text();
  let body = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = null;
  }

  const rows = rowsOf(body);
  const returnDays = new Set();
  const oneWayDays = new Set();
  for (const row of rows) {
    const out = departureOf(row);
    if (!out || !out.startsWith(month)) continue;
    if (returnOf(row)) returnDays.add(out);
    else oneWayDays.add(out);
  }

  const fields = rows[0] ? Object.keys(rows[0]).filter((key) => key !== '__key') : [];
  summary.push({
    endpoint: probe.name,
    status: response.status,
    rows: rows.length,
    returnDays: returnDays.size,
    oneWayDays: oneWayDays.size,
    fields: fields.join(','),
  });

  exchanges.push({
    request: {
      method: 'GET',
      url: redactUrl(url.toString()),
      headers: redactHeaders({ accept: 'application/json' }),
      body: null,
    },
    response: {
      status: response.status,
      statusText: response.statusText,
      headers: redactHeaders(Object.fromEntries(response.headers.entries())),
      body: redactBody(text),
    },
    recordedAt: new Date().toISOString(),
    note: `${probe.name}, ${origin}->${destination}, ${month}`,
  });
}

console.log(`Day coverage for ${origin}-${destination}, ${month}:`);
console.table(summary);

const path = saveCassette({
  name: `aviasales-day-coverage-${origin.toLowerCase()}-${destination.toLowerCase()}`,
  provider: 'aviasales',
  exchanges,
});

console.log(`recorded to ${path}`);
