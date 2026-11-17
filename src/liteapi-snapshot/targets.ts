import { addDays } from '@/core/dates';
import type { GeoPosition, StayOccupancy, StayQuery } from '@/core/stay/types';
import type { IsoDate } from '@/core/trip/types';
import type { LiteApiRatesKey } from '@/db/repository';

/**
 * What the LiteAPI snapshot refreshes: a fixed list of destinations, each in a few date
 * windows, for one party. Pure: it takes `today` and reads no clock.
 *
 * The same module defines the key a page reads with, so the writer and the reader cannot
 * disagree about which row is which.
 */

export interface LaunchDestination {
  /** IATA city code, the same code a stay search carries as `destinationCode`. */
  readonly code: string;
  readonly name: string;
  /** A point in the city centre, for the vendor's hotel list. */
  readonly position: GeoPosition;
}

/**
 * The launch destinations: one constant, so changing the list is changing one line.
 *
 * **Owner to confirm.** These are the six placeholders of the Part 10 design (the explore
 * destinations of Part 1). Every destination added costs 9 rates calls a day at three refreshes.
 */
export const LAUNCH_DESTINATIONS: readonly LaunchDestination[] = [
  { code: 'LIS', name: 'Lisbon', position: { latitude: 38.7223, longitude: -9.1393 } },
  { code: 'BCN', name: 'Barcelona', position: { latitude: 41.3874, longitude: 2.1686 } },
  { code: 'PRG', name: 'Prague', position: { latitude: 50.0755, longitude: 14.4378 } },
  { code: 'BUD', name: 'Budapest', position: { latitude: 47.4979, longitude: 19.0402 } },
  { code: 'ROM', name: 'Rome', position: { latitude: 41.9028, longitude: 12.4964 } },
  { code: 'VIE', name: 'Vienna', position: { latitude: 48.2082, longitude: 16.3738 } },
];

/** Check-in is this many days from today, for each window. */
export const WINDOW_OFFSET_DAYS: readonly number[] = [30, 33, 36];
export const WINDOW_NIGHTS = 4;

/** The one party the snapshot prices. A visitor with any other party reads "not loaded". */
export const SNAPSHOT_OCCUPANCY: StayOccupancy = { adults: 2, children: 0, rooms: 1 };
export const SNAPSHOT_CURRENCY = 'EUR';
/** How many hotels one destination lists, the same cap a live stay search uses. */
export const SNAPSHOT_MAX_HOTELS = 20;

/** `a2-c0-r1`: adults, children, rooms. Stable, so it can be part of a key. */
export function occupancySignature(occupancy: StayOccupancy): string {
  return `a${occupancy.adults}-c${occupancy.children}-r${occupancy.rooms}`;
}

export interface SnapshotTarget {
  readonly destination: LaunchDestination;
  readonly checkIn: IsoDate;
  readonly checkOut: IsoDate;
  readonly occupancy: StayOccupancy;
  readonly currency: string;
  readonly guestNationality: string;
}

/** Every destination in every window, destination-major. */
export function snapshotTargets(
  today: IsoDate,
  guestNationality: string,
  destinations: readonly LaunchDestination[] = LAUNCH_DESTINATIONS,
): SnapshotTarget[] {
  const nationality = guestNationality.toUpperCase();

  return destinations.flatMap((destination) =>
    WINDOW_OFFSET_DAYS.map((offset) => {
      const checkIn = addDays(today, offset);
      return {
        destination,
        checkIn,
        checkOut: addDays(checkIn, WINDOW_NIGHTS),
        occupancy: SNAPSHOT_OCCUPANCY,
        currency: SNAPSHOT_CURRENCY,
        guestNationality: nationality,
      };
    }),
  );
}

/** The storage key for a row, from what a page or a job knows. */
export function ratesKey(input: {
  readonly destinationCode: string;
  readonly checkIn: IsoDate;
  readonly checkOut: IsoDate;
  readonly occupancy: StayOccupancy;
  readonly currency: string;
  readonly guestNationality: string;
}): LiteApiRatesKey {
  return {
    destinationCode: input.destinationCode.toUpperCase(),
    checkIn: input.checkIn,
    checkOut: input.checkOut,
    occupancySig: occupancySignature(input.occupancy),
    currency: input.currency.toUpperCase(),
    guestNationality: input.guestNationality.toUpperCase(),
  };
}

export function targetKey(target: SnapshotTarget): LiteApiRatesKey {
  return ratesKey({ ...target, destinationCode: target.destination.code });
}

/** The query the vendor adapter is asked, for one target. */
export function targetQuery(target: SnapshotTarget): StayQuery {
  return {
    destination: {
      code: target.destination.code,
      name: target.destination.name,
      position: target.destination.position,
      radiusKm: null,
    },
    checkIn: target.checkIn,
    checkOut: target.checkOut,
    occupancy: target.occupancy,
    currency: target.currency,
    maxResults: SNAPSHOT_MAX_HOTELS,
  };
}

/** A stable identifier for a window, for logs and for queue de-duplication. */
export function targetId(target: SnapshotTarget): string {
  return `${target.destination.code}:${target.checkIn}:${target.checkOut}`;
}

/**
 * The most vendor calls a UTC day may make.
 *
 * One rates call per destination, window and refresh, plus one hotel-content call per
 * destination. Content is fetched only when missing or expired (weekly), so the second term is
 * a deliberate over-allowance: it keeps the ceiling a simple, auditable sum, and a content day
 * can never be refused for being a content day.
 */
export function dailyCallCeiling(
  destinations: number,
  windows: number,
  refreshesPerDay: number,
): number {
  return destinations * windows * refreshesPerDay + destinations;
}
