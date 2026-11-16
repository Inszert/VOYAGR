import type { FlightLeg, LocalDateTime } from './types';

/**
 * When a leg lands, on the destination's clock, or null when nobody said.
 *
 * The one place that answers it. Null when the provider did not state the
 * arrival, and also for the shape results cached before that was fixed carry:
 * a single segment whose arrival equals its departure. No flight lands the
 * minute it leaves, so that pair is the departure repeated, not an arrival.
 */
export function legArrival(leg: FlightLeg): LocalDateTime | null {
  const first = leg.segments[0];
  const last = leg.segments.at(-1);
  if (!first || !last || last.arrivesAt === null) return null;
  if (leg.segments.length === 1 && last.arrivesAt === first.departsAt) return null;
  return last.arrivesAt;
}

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
