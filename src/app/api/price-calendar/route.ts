import { NextResponse } from 'next/server';
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

/** Enough to price "anywhere" from the places a search already found, and no more. */
const MAX_DESTINATIONS = 5;

export async function GET(request: Request) {
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
      today: new Date().toISOString().slice(0, 10),
    },
  );

  return NextResponse.json(toMonthPricesJson(prices), {
    headers: { 'Cache-Control': 'no-store' },
  });
}
