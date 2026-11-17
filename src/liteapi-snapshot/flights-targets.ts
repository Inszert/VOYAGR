import { addDays } from '@/core/dates';
import type { IsoDate } from '@/core/trip/types';
import type { LiteApiFlightsKey } from '@/db/repository';
import {
  LAUNCH_DESTINATIONS,
  SNAPSHOT_CURRENCY,
  SNAPSHOT_OCCUPANCY,
  WINDOW_NIGHTS,
  WINDOW_OFFSET_DAYS,
  type LaunchDestination,
} from './targets';

/**
 * What the flight snapshot refreshes: every departure city to every launch destination, in the
 * same three windows the hotel snapshot uses, for the same party. Pure: it takes `today`.
 *
 * Departure is the window's check-in day and the return its check-out day, so a trip's flight
 * and its hotel are priced for the same four nights. The key a page reads with is defined here
 * too, so the writer and the reader cannot disagree about which row is which.
 */

export const FLIGHTS_JOB = 'liteapi.flights.refresh';

/** Economy, round trip, EUR, two adults: the one party the snapshot prices. */
export const FLIGHT_CABIN = 'ECONOMY';
export const FLIGHT_ADULTS = SNAPSHOT_OCCUPANCY.adults;
export const FLIGHT_CURRENCY = SNAPSHOT_CURRENCY;

/** At most one flights call per run. */
export const MAX_FLIGHT_CALLS_PER_RUN = 1;

/** The most offers kept per row: the cheapest few, so one row stays small. */
export const MAX_STORED_OFFERS = 30;

export interface FlightTarget {
  readonly origin: string;
  readonly destination: LaunchDestination;
  readonly departureDate: IsoDate;
  readonly returnDate: IsoDate;
  readonly adults: number;
  readonly currency: string;
  readonly cabin: string;
}

/**
 * Every origin to every destination in every window, origin-major. A destination that is also
 * an origin (Budapest to Budapest) is skipped: there is no such flight to price.
 */
export function flightTargets(
  today: IsoDate,
  origins: readonly string[],
  destinations: readonly LaunchDestination[] = LAUNCH_DESTINATIONS,
): FlightTarget[] {
  return origins.flatMap((origin) =>
    destinations
      .filter((destination) => destination.code !== origin.toUpperCase())
      .flatMap((destination) =>
        WINDOW_OFFSET_DAYS.map((offset) => {
          const departureDate = addDays(today, offset);
          return {
            origin: origin.toUpperCase(),
            destination,
            departureDate,
            returnDate: addDays(departureDate, WINDOW_NIGHTS),
            adults: FLIGHT_ADULTS,
            currency: FLIGHT_CURRENCY,
            cabin: FLIGHT_CABIN,
          };
        }),
      ),
  );
}

/** The storage key for a row, from what a page or a job knows. */
export function flightsKey(input: {
  readonly origin: string;
  readonly destination: string;
  readonly departureDate: IsoDate;
  readonly returnDate: IsoDate;
  readonly adults: number;
  readonly currency: string;
  readonly cabin?: string;
}): LiteApiFlightsKey {
  return {
    origin: input.origin.toUpperCase(),
    destination: input.destination.toUpperCase(),
    departureDate: input.departureDate,
    returnDate: input.returnDate,
    adults: input.adults,
    currency: input.currency.toUpperCase(),
    cabin: (input.cabin ?? FLIGHT_CABIN).toUpperCase(),
  };
}

export function flightTargetKey(target: FlightTarget): LiteApiFlightsKey {
  return flightsKey({ ...target, destination: target.destination.code });
}

/** A stable identifier for a route and window, for logs and queue de-duplication. */
export function flightTargetId(target: {
  readonly origin: string;
  readonly destination: { readonly code: string };
  readonly departureDate: string;
  readonly returnDate: string;
}): string {
  return `${target.origin}>${target.destination.code}:${target.departureDate}:${target.returnDate}`;
}

/**
 * The run record's `destination_code` for a flights run. The runs table has no origin column
 * (migration 0013), so a flights run names its route here: `BUD-LIS`.
 */
export function flightRunLabel(origin: string, destination: string): string {
  return `${origin}-${destination}`;
}

/**
 * The most flight calls a UTC day may make: origins x destinations x windows x refreshes. The
 * real count is lower (an origin that is also a destination is skipped), so this is a ceiling,
 * not a forecast. Held separately from the hotel ceiling, so neither job can starve the other.
 */
export function dailyFlightCallCeiling(
  origins: number,
  destinations: number,
  windows: number,
  refreshesPerDay: number,
): number {
  return origins * destinations * windows * refreshesPerDay;
}
