/**
 * Proves the price calendar has a price for every day of a month.
 *
 * `npm run check:calendar` - runs the same loader the calendar's route uses,
 * against the mock flight provider, for the next three months, and fails if a
 * day the mock has a flight on comes back without a price. The mock has a
 * flight on every day, so a gap here is the loader losing days, which is the
 * fault this check exists to catch.
 *
 * Reads no environment and makes no network call.
 */

import { MemoryCacheStore } from '../src/cache/memory.ts';
import { addMonths, daysInMonth, startOfMonth } from '../src/core/dates.ts';
import { createLimiterPool } from '../src/lib/concurrency.ts';
import { createMockFlightProvider } from '../src/providers/flights/mock.ts';
import { loadMonthDayPrices } from '../src/search/day-prices.ts';
import { toMonthPricesJson } from '../src/search/day-prices-json.ts';

const today = new Date().toISOString().slice(0, 10);
const deps = {
  flights: createMockFlightProvider(),
  store: new MemoryCacheStore(),
  pool: createLimiterPool(4),
  today,
};

let missing = 0;

for (let offset = 1; offset <= 3; offset += 1) {
  const first = addMonths(startOfMonth(today), offset);
  const month = first.slice(0, 7);

  const json = toMonthPricesJson(
    await loadMonthDayPrices(
      { origin: 'VIE', destinations: ['AYT'], month, currency: 'EUR' },
      deps,
    ),
  );

  const expected = daysInMonth(first);
  const gaps = [];

  for (let day = 1; day <= expected; day += 1) {
    const date = `${month}-${String(day).padStart(2, '0')}`;
    if (!json.days[date]?.whole) gaps.push(date);
  }

  missing += gaps.length;
  console.log(
    `${month}: ${expected - gaps.length}/${expected} days priced` +
      (gaps.length > 0 ? ` - no price on ${gaps.join(', ')}` : ''),
  );
}

if (missing > 0) {
  console.error(`FAIL: ${missing} day(s) without a price.`);
  process.exit(1);
}

console.log('OK: every day of every month has a price.');
