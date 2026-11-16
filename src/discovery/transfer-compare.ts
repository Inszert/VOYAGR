import type { Money } from '@/core/money';
import { distanceMetres } from '@/core/distance';
import { perTraveller } from '@/core/party';
import type { TransferOffer } from '@/core/trip/types';

/**
 * "Getting in from the airport", as a comparison.
 *
 * A model of what to draw, never a calculation of what to say: every figure is
 * the transfer provider's (`pricePerDirection` is what the whole party pays one
 * way), the per-person share is `perTraveller` from core, and the distance is
 * the core great-circle distance between the airport and the city centre. What
 * this adds is *which is cheapest*, *which is fastest* and *how long each bar
 * is* - comparisons of the provider's own numbers, with no new number in them.
 */

export interface TransferRow {
  readonly offer: TransferOffer;
  /** The party's price one way, as the provider states it. */
  readonly party: Money;
  /** The share of it per traveller, rounded down to the minor unit. */
  readonly each: Money;
  /** 0-1: this option's minutes over the longest, so the fastest is visibly the shortest. */
  readonly barShare: number;
  readonly cheapest: boolean;
  readonly fastest: boolean;
}

export interface TransferComparison {
  readonly rows: readonly TransferRow[];
  /** The longest journey, in minutes: the far end of the shared scale. */
  readonly scaleMinutes: number;
}

/** Cheapest and fastest in words need something to be cheaper than. */
export function compareTransfers(
  offers: readonly TransferOffer[],
  travellers: number,
): TransferComparison | null {
  if (offers.length === 0) return null;

  const scaleMinutes = Math.max(...offers.map((offer) => offer.durationMinutes), 1);
  const currency = offers[0]!.pricePerDirection.currency;
  // Prices in two currencies cannot be ranked without a rate, and a rate is never guessed.
  const comparable = offers.every((offer) => offer.pricePerDirection.currency === currency);
  const cheapestAmount = comparable
    ? Math.min(...offers.map((offer) => offer.pricePerDirection.amount))
    : null;
  const fastestMinutes = Math.min(...offers.map((offer) => offer.durationMinutes));
  const several = offers.length > 1;

  return {
    scaleMinutes,
    rows: offers.map((offer) => ({
      offer,
      party: offer.pricePerDirection,
      each: perTraveller(offer.pricePerDirection, travellers).each,
      barShare: Math.max(0.04, offer.durationMinutes / scaleMinutes),
      // A label that holds for every row says nothing, so it needs a rival.
      cheapest: several && offer.pricePerDirection.amount === cheapestAmount,
      fastest: several && offer.durationMinutes === fastestMinutes,
    })),
  };
}

/**
 * The straight-line distance from an airport to the centre of the city it
 * serves, in metres, or null when either end is unknown or they are the same
 * point (a reference airport placed at its own city, which is no distance).
 */
export function airportToCentreMetres(
  airport: readonly [number, number] | null,
  centre: readonly [number, number] | null,
): number | null {
  if (!airport || !centre) return null;
  const metres = distanceMetres(
    { longitude: airport[0], latitude: airport[1] },
    { longitude: centre[0], latitude: centre[1] },
  );

  // Under 500 m means "the same place": the data placed both at one point.
  return metres < 500 ? null : metres;
}
