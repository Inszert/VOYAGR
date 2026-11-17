import { z } from 'zod';
import { money } from '@/core/money';
import type { FlightOffer } from '@/core/trip/types';
import { flightOfferSchema } from '@/providers/schema';

/**
 * What a stored flights row is allowed to hold, and how it is read back.
 *
 * Same rule as `stored-schema.ts` for hotels: a stored row is still input. It is checked with
 * the same `flightOfferSchema` a vendor's offers pass at the provider boundary, Money is rebuilt
 * through `money()`, and a row written under another `schema_version` is refused outright.
 *
 * **Bump `FLIGHTS_STORED_SCHEMA_VERSION` whenever `FlightOffer` or what is stored changes.**
 * Old rows then read as "not loaded" until the next refresh replaces them.
 */
export const FLIGHTS_STORED_SCHEMA_VERSION = 1;

const offersSchema = z.array(flightOfferSchema);

export type FlightsStoredFailure = 'schema_version' | 'invalid';

export type StoredFlightsResult =
  | { readonly ok: true; readonly offers: readonly FlightOffer[] }
  | { readonly ok: false; readonly reason: FlightsStoredFailure };

/**
 * The stored `offers` column as flight offers, or the reason it cannot be used. One bad offer
 * fails the whole row: a half-read snapshot would quote a route's cheapest as the cheapest of a
 * partial list, and the next refresh replaces the row anyway.
 */
export function readStoredFlights(schemaVersion: number, stored: unknown): StoredFlightsResult {
  if (schemaVersion !== FLIGHTS_STORED_SCHEMA_VERSION)
    return { ok: false, reason: 'schema_version' };

  const parsed = offersSchema.safeParse(stored);
  if (!parsed.success) return { ok: false, reason: 'invalid' };

  const offers = parsed.data.map((offer): FlightOffer => ({
    ...(offer as unknown as FlightOffer),
    price: money(offer.price.amount, offer.price.currency),
  }));
  return { ok: true, offers };
}

/** What goes into the `offers` column. Plain data: Money is `{ amount, currency }`. */
export function toStoredFlights(offers: readonly FlightOffer[]): unknown {
  return offers.map((offer) => ({ ...offer }));
}
