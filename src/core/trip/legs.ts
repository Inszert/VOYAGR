import type { FlightLeg } from './types';

/**
 * How many connections a leg has.
 *
 * The one place that answers it. A leg with itemised segments has one fewer
 * connection than it has segments. A cached-price vendor (Aviasales) counts the
 * connections but never says where they are, so the leg carries
 * `connectionsStated` and a single segment spanning the whole journey rather
 * than an invented itinerary. Whichever says more wins: a stated connection is
 * never hidden by a segment list that happens to be short.
 */
export function connectionCount(leg: FlightLeg): number {
  return Math.max(leg.segments.length - 1, leg.connectionsStated ?? 0, 0);
}

/**
 * True when the connections are counted but not itemised, so a card must say
 * "1 stop" and must not name an airport it was never told.
 */
export function connectionsUnitemised(leg: FlightLeg): boolean {
  return (leg.connectionsStated ?? 0) > leg.segments.length - 1;
}
