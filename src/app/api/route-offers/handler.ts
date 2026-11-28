import { NextResponse } from 'next/server';
import { isIsoDate } from '@/core/dates';
import { format } from '@/core/money';
import type { FlightLeg, FlightOffer } from '@/core/trip/types';
import type { KiwiLookup, KiwiLookupResult } from '@/providers/flights/kiwi-read-path';

/**
 * What a click on a route asks for: the 12-hour read path for one origin, destination and dates.
 * This is the only place the globe's data can reach a provider, and only because a person clicked.
 *
 * The response is already worded: prices are formatted here from `Money`, so the browser does no
 * arithmetic and never sees a bare number it could mistake for a price.
 */

const IATA = /^[A-Z]{3}$/;

export interface OfferLegDto {
  readonly departsAt: string;
  readonly arrivesAt: string | null;
  readonly durationMinutes: number;
  readonly stops: number;
  readonly flights: readonly string[];
}

export interface OfferDto {
  readonly id: string;
  readonly price: string;
  readonly bookingUrl: string | null;
  readonly outbound: OfferLegDto;
  readonly inbound: OfferLegDto;
}

export interface RouteOffersDto {
  readonly status: 'fresh' | 'stale' | 'no_data';
  /** "checked 3 h ago", or "no data yet". */
  readonly label: string;
  readonly observedAt: string | null;
  readonly offers: readonly OfferDto[];
  /** Set when the live refresh failed, so the page can say the shown data is old. */
  readonly refreshFailed: boolean;
}

function leg(value: FlightLeg): OfferLegDto {
  const first = value.segments[0];
  const last = value.segments[value.segments.length - 1];
  return {
    departsAt: first?.departsAt ?? '',
    arrivesAt: last?.arrivesAt ?? null,
    durationMinutes: value.durationMinutes,
    stops: Math.max(0, value.connectionsStated ?? value.segments.length - 1),
    flights: value.segments.map((s) => `${s.carrier} ${s.flightNumber}`),
  };
}

function offer(value: FlightOffer): OfferDto {
  return {
    id: value.id,
    price: format(value.price),
    bookingUrl: value.deepLink ?? null,
    outbound: leg(value.outbound),
    inbound: leg(value.inbound),
  };
}

export function toRouteOffersDto(result: KiwiLookupResult): RouteOffersDto {
  return {
    status: result.status,
    label: result.label,
    observedAt: result.observedAt,
    offers: result.offers.map(offer),
    refreshFailed: result.error !== null,
  };
}

export function createRouteOffersHandler(lookup: (query: KiwiLookup) => Promise<KiwiLookupResult>) {
  return async function GET(request: Request): Promise<Response> {
    const params = new URL(request.url).searchParams;
    const query: KiwiLookup = {
      origin: (params.get('origin') ?? '').toUpperCase(),
      destination: (params.get('destination') ?? '').toUpperCase(),
      departureDate: params.get('departureDate') ?? '',
      returnDate: params.get('returnDate') ?? '',
      adults: Number(params.get('adults') ?? 1),
      currency: (params.get('currency') ?? 'EUR').toUpperCase(),
    };

    if (
      !IATA.test(query.origin) ||
      !IATA.test(query.destination) ||
      query.origin === query.destination ||
      !isIsoDate(query.departureDate) ||
      !isIsoDate(query.returnDate) ||
      query.returnDate < query.departureDate ||
      !Number.isSafeInteger(query.adults) ||
      query.adults < 1 ||
      query.adults > 9 ||
      !IATA.test(query.currency)
    ) {
      return NextResponse.json(
        { title: 'The request was not valid.', status: 400 },
        { status: 400, headers: { 'Cache-Control': 'no-store' } },
      );
    }

    const result = await lookup(query);
    return NextResponse.json(toRouteOffersDto(result), {
      headers: { 'Cache-Control': 'no-store' },
    });
  };
}
