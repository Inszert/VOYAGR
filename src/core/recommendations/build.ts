import { compare } from '@/core/money';
import type { FlightOffer } from '@/core/trip/types';
import type { RecommendationItem } from '@/db/repository';

/**
 * A recommendation list from flight offers: the cheapest return per destination, cheapest first.
 *
 * Deterministic and pure. The price on each line is the offer's own `Money`, copied as integer
 * minor units; nothing is added, converted or estimated here, and no model is involved. Offers in
 * a currency other than `currency` are left out rather than compared across currencies.
 */

export const RECOMMENDATION_LIST_SIZE = 12;

function dayOf(localDateTime: string): string {
  return localDateTime.slice(0, 10);
}

export function buildRecommendationItems(
  offers: readonly FlightOffer[],
  currency: string,
  limit: number = RECOMMENDATION_LIST_SIZE,
): RecommendationItem[] {
  const cheapest = new Map<string, FlightOffer>();
  for (const offer of offers) {
    if (offer.price.currency.toUpperCase() !== currency.toUpperCase()) continue;
    if (offer.price.amount <= 0) continue;
    const out = offer.outbound.segments;
    const back = offer.inbound.segments;
    const last = out[out.length - 1];
    if (!out[0] || !back[0] || !last) continue;
    const held = cheapest.get(last.destination);
    if (!held || compare(offer.price, held.price) < 0) cheapest.set(last.destination, offer);
  }

  return [...cheapest.entries()]
    .map(([destination, offer]) => ({
      destination,
      priceMinor: offer.price.amount,
      currency: currency.toUpperCase(),
      departureDate: dayOf(offer.outbound.segments[0]!.departsAt),
      returnDate: dayOf(offer.inbound.segments[0]!.departsAt),
      carrier: offer.outbound.segments[0]!.carrier || null,
      deepLink: offer.deepLink ?? null,
    }))
    .sort((a, b) => a.priceMinor - b.priceMinor || a.destination.localeCompare(b.destination))
    .slice(0, limit);
}
