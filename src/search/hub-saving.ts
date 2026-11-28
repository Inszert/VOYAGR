import { ageOf, FLIGHT_MAX_AGE_MS } from '@/core/freshness';
import { candidatesFor, TRANSFER_CURRENCY, type AirportPoint } from '@/core/hub/candidates';
import { compareCandidates, type CompareThresholds } from '@/core/hub/compare';
import type { IsoDate } from '@/core/trip/types';
import type { KiwiOffersKey, KiwiOffersRepository } from '@/db/repository';
import { allAirports } from '@/providers/reference/airports';

/**
 * "Cheaper from BTS": a nearby airport that beats the searched one in total, only when material.
 *
 * Prices are read from storage (the same rows the 12-hour read path writes) and never fetched: this
 * runs during a page render, which makes no MCP call. A candidate with no fresh stored price is
 * left out, not guessed. The ground transfer is the documented estimate from `src/core/hub`, in
 * EUR; a search in another currency gets no line, because there is no rate to convert it with.
 */

export interface HubSaving {
  readonly origin: string;
  readonly code: string;
  readonly savingMinor: number;
  readonly transferMinor: number;
  readonly currency: string;
}

export interface HubSavingInput {
  readonly origin: string;
  readonly destination: string;
  readonly departureDate: IsoDate;
  readonly returnDate: IsoDate;
  readonly adults: number;
  readonly currency: string;
  /** The searched origin's own cheapest flight, minor units. */
  readonly requestedFlightMinor: number;
  readonly offers: Pick<KiwiOffersRepository, 'get'>;
  readonly thresholds?: CompareThresholds;
  readonly airports?: readonly AirportPoint[];
  readonly now?: () => number;
}

function airportPoints(): AirportPoint[] {
  return allAirports().map((a) => ({
    code: a.code,
    latitude: a.position[1],
    longitude: a.position[0],
    size: a.size,
  }));
}

/** Cheapest stored price, in the key's currency, from a row that is still within 12 h; else null. */
function storedPrice(
  row: Awaited<ReturnType<KiwiOffersRepository['get']>>,
  currency: string,
  now: number,
) {
  if (!row || !Array.isArray(row.offers)) return null;
  const age = ageOf(row.observedAt, now);
  if (age === null || age < -60_000 || age > FLIGHT_MAX_AGE_MS) return null;
  let best: number | null = null;
  for (const offer of row.offers as unknown[]) {
    const price = (offer as { price?: { amount?: unknown; currency?: unknown } } | null)?.price;
    if (
      !price ||
      price.currency !== currency ||
      typeof price.amount !== 'number' ||
      !Number.isSafeInteger(price.amount) ||
      price.amount < 0
    ) {
      continue;
    }
    if (best === null || price.amount < best) best = price.amount;
  }
  return best;
}

export async function findHubSaving(input: HubSavingInput): Promise<HubSaving | null> {
  const currency = input.currency.toUpperCase();
  if (currency !== TRANSFER_CURRENCY) return null;
  const origin = input.origin.toUpperCase();
  const candidates = candidatesFor(origin, input.airports ?? airportPoints());
  const others = candidates.filter((c) => c.code !== origin);
  if (others.length === 0) return null;
  const now = (input.now ?? Date.now)();

  const key = (code: string): KiwiOffersKey => ({
    origin: code,
    destination: input.destination.toUpperCase(),
    departureDate: input.departureDate,
    returnDate: input.returnDate,
    adults: input.adults,
    currency,
  });
  const priced = await Promise.all(
    others.map(async (c) => {
      try {
        return { c, flight: storedPrice(await input.offers.get(key(c.code)), currency, now) };
      } catch {
        return { c, flight: null };
      }
    }),
  );
  if (priced.every((p) => p.flight === null)) return null;

  const comparison = compareCandidates(
    origin,
    [
      { code: origin, flightMinor: input.requestedFlightMinor, transferMinor: 0 },
      ...priced.map((p) => ({
        code: p.c.code,
        flightMinor: p.flight,
        transferMinor: p.c.transferCost.amount,
      })),
    ],
    input.thresholds,
  );
  if (!comparison.material || !comparison.cheapest) return null;
  return {
    origin,
    code: comparison.cheapest.code,
    savingMinor: comparison.savingMinor,
    transferMinor: comparison.cheapest.transferMinor,
    currency,
  };
}
