import { daysBetween, localDate } from '../dates';
import { add, lessThanOrEqual } from '../money';
import type { FlightOffer, IsoDate, OneWayFare } from './types';

/**
 * A return journey built from two one-way fares.
 *
 * A cache of round-trip prices holds only the date pairs somebody searched,
 * and for most routes that is a few days a month; the same vendor's cache of
 * one-way prices is far denser. So when no return fare exists for a pair of
 * days, the trip can still be priced as two single tickets: the cheapest out
 * on the departure day plus the cheapest back on the return day.
 *
 * That is a real difference in what is bought - two bookings, each with its
 * own terms, neither protecting the other - so the offer built here is marked
 * `ticketing: 'two_one_way'` and carries both booking links, and the
 * constraint engine warns about it in words.
 *
 * The total is `add` on two `Money` values in one currency, exactly; two
 * currencies are never paired. Pure: no I/O, no clock.
 */

export interface PairBounds {
  readonly minNights: number;
  readonly maxNights: number;
  /** Only departures on or after this day, and returns on or before `latestReturn`. */
  readonly earliestDeparture?: IsoDate;
  readonly latestReturn?: IsoDate;
}

function dayOf(fare: OneWayFare): IsoDate | null {
  const first = fare.leg.segments[0];
  return first ? localDate(first.departsAt) : null;
}

/** The cheapest fare per departure day; ties keep the first seen. */
function cheapestByDay(fares: readonly OneWayFare[]): Map<IsoDate, OneWayFare> {
  const best = new Map<IsoDate, OneWayFare>();
  for (const fare of fares) {
    const day = dayOf(fare);
    if (!day) continue;
    const seen = best.get(day);
    if (
      !seen ||
      (seen.price.currency === fare.price.currency && fare.price.amount < seen.price.amount)
    ) {
      if (!seen || seen.price.currency === fare.price.currency) best.set(day, fare);
    }
  }
  return best;
}

/** The older of two instants: a pair is as fresh as its staler half. */
function older(a: string, b: string): string {
  return Date.parse(a) <= Date.parse(b) ? a : b;
}

/** Every (out, back) pair inside the bounds, as one offer each. */
export function pairOneWayFares(
  outbound: readonly OneWayFare[],
  inbound: readonly OneWayFare[],
  bounds: PairBounds,
): FlightOffer[] {
  const outs = cheapestByDay(outbound);
  const backs = cheapestByDay(inbound);
  const pairs: FlightOffer[] = [];

  for (const [departure, out] of outs) {
    if (bounds.earliestDeparture && departure < bounds.earliestDeparture) continue;

    for (const [returnDay, back] of backs) {
      if (bounds.latestReturn && returnDay > bounds.latestReturn) continue;
      const nights = daysBetween(departure, returnDay);
      if (nights < bounds.minNights || nights > bounds.maxNights) continue;
      if (out.price.currency !== back.price.currency) continue;

      pairs.push({
        id: `pair:${out.id}+${back.id}`,
        providerId: out.providerId,
        outbound: out.leg,
        inbound: back.leg,
        price: add(out.price, back.price),
        observedAt: older(out.observedAt, back.observedAt),
        expiresAt: null,
        ticketing: 'two_one_way',
        ...(out.deepLink ? { deepLink: out.deepLink } : {}),
        ...(back.deepLink ? { returnDeepLink: back.deepLink } : {}),
      });
    }
  }

  return pairs;
}

/** The days a flight offer flies, as the key a pair is compared under. */
function dayPair(offer: FlightOffer): string | null {
  const out = offer.outbound.segments[0];
  const back = offer.inbound.segments[0];
  const arrival = offer.outbound.segments.at(-1)?.destination;
  return out && back && arrival
    ? `${arrival}|${localDate(out.departsAt)}|${localDate(back.departsAt)}`
    : null;
}

/**
 * Round-trip offers plus the pairs that improve on them.
 *
 * A pair is kept only for days no return fare covers, or where every return
 * fare for those days costs more: a round trip that is cheaper or equal wins,
 * because one ticket is the better thing to buy at the same price.
 */
export function withPairs(
  roundTrips: readonly FlightOffer[],
  pairs: readonly FlightOffer[],
): FlightOffer[] {
  const cheapest = new Map<string, FlightOffer>();
  for (const offer of roundTrips) {
    const key = dayPair(offer);
    if (!key) continue;
    const seen = cheapest.get(key);
    if (
      !seen ||
      (seen.price.currency === offer.price.currency && offer.price.amount < seen.price.amount)
    ) {
      cheapest.set(key, offer);
    }
  }

  const kept = pairs.filter((pair) => {
    const key = dayPair(pair);
    const roundTrip = key ? cheapest.get(key) : undefined;
    if (!roundTrip) return true;
    if (roundTrip.price.currency !== pair.price.currency) return false;
    return !lessThanOrEqual(roundTrip.price, pair.price);
  });

  return [...roundTrips, ...kept];
}
