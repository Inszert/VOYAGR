import { NextResponse } from 'next/server';
import { addMonths } from '@/core/dates';
import { FixedWindowLimiter } from '@/lib/fixed-window';
import { resolveClientKey } from '@/lib/client-key';
import { getProviderRegistry } from '@/providers/registry';
import { getActiveDataSource } from '@/providers/request-source';
import { isMonth, loadMonthDayPrices } from '@/search/day-prices';
import { toMonthPricesJson } from '@/search/day-prices-json';

/**
 * One month of per-day flight prices for the price calendar.
 *
 * `?origin=VIE&destinations=AYT,PMI&month=2026-12&currency=EUR`
 *
 * A provider failure is a 200 with no days and a reason: the calendar stays
 * usable, and a missing price is not an error the page should break on. Only a
 * request that is malformed is refused.
 */

export const dynamic = 'force-dynamic';

const IATA = /^[A-Z]{3}$/;

/**
 * The month must be one a fare can exist for: this month through a year out.
 * Anything else is either already over or beyond every airline's schedule, and
 * accepting it would let a caller mint endless distinct cache keys.
 */
const MONTHS_AHEAD = 12;

/**
 * Per client, per minute, hits and misses alike. A page needs two or three.
 * The key is only as honest as the proxy's forwarded address, so this narrows
 * one noisy client; the real ceiling on provider spend is the shared load
 * budget in `src/search/day-prices.ts`. A request with no client address
 * shares no bucket rather than one bucket for everybody.
 */
const CLIENT_REQUESTS_PER_MINUTE = 60;

declare global {
  var __voyagrPriceCalendarClients: FixedWindowLimiter | undefined;
}

function clientLimiter(): FixedWindowLimiter {
  globalThis.__voyagrPriceCalendarClients ??= new FixedWindowLimiter({
    max: CLIENT_REQUESTS_PER_MINUTE,
    windowMs: 60_000,
  });
  return globalThis.__voyagrPriceCalendarClients;
}

function inWindow(month: string, today: string): boolean {
  const first = `${today.slice(0, 7)}-01`;
  return month >= first.slice(0, 7) && month <= addMonths(first, MONTHS_AHEAD).slice(0, 7);
}

/** Enough to price "anywhere" from the places a search already found, and no more. */
const MAX_DESTINATIONS = 5;

export async function GET(request: Request) {
  const today = new Date().toISOString().slice(0, 10);

  // Before parsing or any provider work: a refused request costs almost nothing.
  const client = await resolveClientKey();
  if (client !== 'unknown-client') {
    const decision = clientLimiter().take(client);
    if (!decision.allowed) {
      return NextResponse.json(
        { title: 'Too many requests.', status: 429 },
        {
          status: 429,
          headers: {
            'Cache-Control': 'no-store',
            'Retry-After': String(decision.retryAfterSeconds),
          },
        },
      );
    }
  }

  const params = new URL(request.url).searchParams;

  const origin = (params.get('origin') ?? '').toUpperCase();
  const destinations = (params.get('destinations') ?? '')
    .split(',')
    .map((code) => code.trim().toUpperCase())
    .filter(Boolean);
  const month = params.get('month') ?? '';
  const currency = (params.get('currency') ?? 'EUR').toUpperCase();
  const passengers = Number(params.get('passengers') ?? 1);

  if (
    !IATA.test(origin) ||
    destinations.length === 0 ||
    destinations.length > MAX_DESTINATIONS ||
    !destinations.every((code) => IATA.test(code)) ||
    !isMonth(month) ||
    !inWindow(month, today) ||
    !/^[A-Z]{3}$/.test(currency) ||
    !Number.isSafeInteger(passengers) ||
    passengers < 1 ||
    passengers > 9
  ) {
    return NextResponse.json(
      { title: 'The request was not valid.', status: 400 },
      { status: 400, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  const optionalNights = (name: string) => {
    const value = Number(params.get(name));
    return params.has(name) && Number.isSafeInteger(value) && value >= 1 && value <= 30
      ? { [name]: value }
      : {};
  };

  const source = (await getActiveDataSource()).effective;
  const prices = await loadMonthDayPrices(
    {
      origin,
      destinations,
      month,
      currency,
      passengers,
      ...optionalNights('minNights'),
      ...optionalNights('maxNights'),
    },
    {
      flights: getProviderRegistry(source).flights,
      today,
    },
  );

  return NextResponse.json(toMonthPricesJson(prices), {
    headers: { 'Cache-Control': 'no-store' },
  });
}
