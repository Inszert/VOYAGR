import type { TripCandidate } from './types';

/**
 * Usable vacation time (specification section 31.4).
 *
 * Two trips with the same number of nights can deliver very different holidays.
 * A 23:40 arrival and a 05:50 departure turn "5 nights" into roughly three
 * usable days. This module turns that intuition into a number that can be
 * compared, scored and explained.
 *
 * Pure arithmetic over timestamps. No provider calls, no model involvement.
 */

const MINUTES_PER_HOUR = 60;
const MINUTES_PER_DAY = 24 * MINUTES_PER_HOUR;

/** A day is only counted as usable between these local hours. */
export const USABLE_DAY_START_HOUR = 8;
export const USABLE_DAY_END_HOUR = 22;

export interface UsableTimeAssumptions {
  /** Time from landing to leaving the airport. */
  airportExitMinutes: number;
  /** Time to be at the airport before the return flight departs. */
  checkInLeadMinutes: number;
  /** Airport-to-hotel transfer, each way. */
  transferMinutes: number;
}

export const DEFAULT_USABLE_TIME_ASSUMPTIONS: UsableTimeAssumptions = {
  airportExitMinutes: 35,
  checkInLeadMinutes: 120,
  transferMinutes: 40,
};

/*
 * Hotel check-in and check-out are deliberately not modelled.
 *
 * An early arrival is not dead time: reception stores bags and the day starts
 * anyway. Likewise a late flight does not require holding the room. The
 * 08:00-22:00 usable window already excludes the hours nobody would use, so
 * adding a check-in clamp on top would double-penalise a midday arrival.
 */

export interface UsableTimeResult {
  /** Usable minutes on the arrival day. */
  readonly arrivalDayMinutes: number;
  /** Usable minutes on the departure day. */
  readonly departureDayMinutes: number;
  /** Usable minutes across the untouched days in between. */
  readonly fullDayMinutes: number;
  readonly totalMinutes: number;
  readonly totalHours: number;
  /** Total expressed in whole usable days, for display. */
  readonly equivalentFullDays: number;
  /** Number of nights actually paid for, for comparison against usable time. */
  readonly nights: number;
  readonly assumptions: UsableTimeAssumptions;
}

/** Minutes past local midnight, read from the timestamp without zone conversion. */
function minutesIntoDay(isoDateTime: string): number {
  const hours = Number.parseInt(isoDateTime.slice(11, 13), 10);
  const minutes = Number.parseInt(isoDateTime.slice(14, 16), 10);

  if (Number.isNaN(hours) || Number.isNaN(minutes)) {
    throw new TypeError(`Cannot read a local time from ${JSON.stringify(isoDateTime)}`);
  }

  return hours * MINUTES_PER_HOUR + minutes;
}

const usableWindowStart = USABLE_DAY_START_HOUR * MINUTES_PER_HOUR;
const usableWindowEnd = USABLE_DAY_END_HOUR * MINUTES_PER_HOUR;
const usableWindowLength = usableWindowEnd - usableWindowStart;

/** Clamp an arbitrary minute range to the usable part of a day. */
function usableMinutesBetween(startMinute: number, endMinute: number): number {
  const start = Math.max(startMinute, usableWindowStart);
  const end = Math.min(endMinute, usableWindowEnd);
  return Math.max(0, end - start);
}

/**
 * Compute usable vacation time for a candidate.
 *
 * Arrival day: usable time runs from the moment the traveller is settled
 * (landing + airport exit + transfer) until the end of the usable evening
 * window.
 *
 * Departure day: usable time runs from the start of the usable morning window
 * until the traveller must leave for the airport (departure - check-in lead -
 * transfer).
 */
export function computeUsableTime(
  candidate: TripCandidate,
  overrides: Partial<UsableTimeAssumptions> = {},
): UsableTimeResult {
  const assumptions: UsableTimeAssumptions = {
    ...DEFAULT_USABLE_TIME_ASSUMPTIONS,
    ...(candidate.transfer ? { transferMinutes: candidate.transfer.durationMinutes } : {}),
    ...overrides,
  };

  const arrivalSegment = candidate.flight.outbound.segments.at(-1);
  const departureSegment = candidate.flight.inbound.segments[0];

  if (!arrivalSegment || !departureSegment) {
    throw new TypeError(`Trip ${candidate.id} has a leg with no segments`);
  }

  // --- Arrival day --------------------------------------------------------
  const landedAt = minutesIntoDay(arrivalSegment.arrivesAt);
  const settledAt = landedAt + assumptions.airportExitMinutes + assumptions.transferMinutes;
  const arrivalDayMinutes = usableMinutesBetween(settledAt, MINUTES_PER_DAY);

  // --- Departure day ------------------------------------------------------
  const departsAt = minutesIntoDay(departureSegment.departsAt);
  const mustLeaveAt = departsAt - assumptions.checkInLeadMinutes - assumptions.transferMinutes;
  const departureDayMinutes = usableMinutesBetween(0, mustLeaveAt);

  // --- Whole days in between ---------------------------------------------
  // `nights` covers arrival night through the night before departure, so the
  // count of untouched days is one fewer.
  const fullDays = Math.max(0, candidate.dates.nights - 1);
  const fullDayMinutes = fullDays * usableWindowLength;

  const totalMinutes = arrivalDayMinutes + departureDayMinutes + fullDayMinutes;

  return {
    arrivalDayMinutes,
    departureDayMinutes,
    fullDayMinutes,
    totalMinutes,
    totalHours: Math.round((totalMinutes / MINUTES_PER_HOUR) * 10) / 10,
    equivalentFullDays: Math.round((totalMinutes / usableWindowLength) * 10) / 10,
    nights: candidate.dates.nights,
    assumptions,
  };
}

/** Theoretical maximum usable time for a stay of `nights` nights. */
export function maximumUsableMinutes(nights: number): number {
  return (nights + 1) * usableWindowLength;
}

/**
 * Efficiency of a trip, 0-1: how much of the theoretically available holiday the
 * itinerary actually delivers. Feeds the scoring engine as a normalised input.
 */
export function usableTimeEfficiency(result: UsableTimeResult): number {
  const maximum = maximumUsableMinutes(result.nights);
  if (maximum <= 0) return 0;
  return Math.min(1, result.totalMinutes / maximum);
}
