import { fromMajor, greaterThan, lessThan, type Money } from '@/core/money';
import { localHour } from '@/core/dates';
import { connectionCount } from '@/core/trip/legs';
import type { RankedTrip } from './types';

/**
 * Narrowing a result set (1.10.1 section 10).
 *
 * Filters narrow what the search already found. They do **not** re-run it.
 *
 * That is a cost decision before it is a design one: a search is dozens of
 * provider calls, and with a live vendor each is billed. Re-running on every
 * chip toggle would make an idle user expensive. The result set is already
 * bounded, ranked and complete enough to narrow honestly.
 *
 * Filters live in the query string for the same reason categories do: the page
 * works before JavaScript, a narrowed view can be shared, and the back button
 * undoes it. The underlying search is served from the page cache, so toggling
 * a filter costs no provider calls at all.
 *
 * Pure and deterministic. Every predicate reads a figure the engines already
 * computed; none of them recomputes a total or re-scores a trip.
 */

export interface ResultFilters {
  /** Hide trips whose total exceeds this. */
  readonly maxTotal: Money | null;
  /** Hide trips whose total is below this. */
  readonly minTotal: Money | null;
  /** Hide anything with a connection. */
  readonly directOnly: boolean;
  /** Connections allowed per leg. Null means no limit. */
  readonly maxStops: number | null;
  /** Earliest acceptable outbound departure hour, local at the origin. */
  readonly departAfterHour: number | null;
  /**
   * The hour the outbound flight must leave *before*, local at the origin.
   * 22 keeps flights up to 21:59. Null means no upper bound.
   */
  readonly departBeforeHour: number | null;
  /** Earliest acceptable hour for the return flight to leave, local at the destination. */
  readonly returnAfterHour: number | null;
  /** The hour the return flight must leave before, local at the destination. */
  readonly returnBeforeHour: number | null;
  /**
   * Latest acceptable arrival hour, local at the destination.
   *
   * Only meaningful where the provider states an arrival time - a cached-fare
   * vendor does not, and `anyArrivalKnown` is how the page knows whether to
   * offer this at all.
   */
  readonly arriveBeforeHour: number | null;
  readonly freeCancellationOnly: boolean;
  readonly minReviewScore: number | null;
  /** Hide connections sold on separate tickets. */
  readonly excludeSelfTransfer: boolean;
  /** Hide trips where no airport transfer was priced. */
  readonly requirePricedTransfer: boolean;
  /**
   * Keep only one set of dates, as `2026-06-10..2026-06-15`.
   *
   * A filter rather than a new search on purpose: the search already priced
   * every date window it sampled, so narrowing to one of them costs nothing
   * and - more importantly - shows exactly the trips whose total the date
   * breakdown quoted. A re-search would return a different set of trips from
   * the number the user just clicked on.
   */
  readonly dates: string | null;
  /**
   * Keep only one destination, by airport code.
   *
   * Set by picking a place on the discovery map. A filter and not a search for
   * the same reason as the dates: the trips are priced already, and narrowing
   * to one of them is free and exact.
   */
  readonly destination: string | null;
}

export const NO_FILTERS: ResultFilters = {
  maxTotal: null,
  minTotal: null,
  directOnly: false,
  maxStops: null,
  departAfterHour: null,
  departBeforeHour: null,
  returnAfterHour: null,
  returnBeforeHour: null,
  arriveBeforeHour: null,
  freeCancellationOnly: false,
  minReviewScore: null,
  excludeSelfTransfer: false,
  requirePricedTransfer: false,
  dates: null,
  destination: null,
};

/** Query-string keys, prefixed so they cannot collide with the search itself. */
export const FILTER_KEYS = [
  'fMaxTotal',
  'fMinTotal',
  'fDirect',
  'fMaxStops',
  'fDepartAfter',
  'fDepartBefore',
  'fReturnAfter',
  'fReturnBefore',
  'fArriveBefore',
  'fFreeCancel',
  'fMinReview',
  'fNoSelfTransfer',
  'fTransferPriced',
  'fDates',
  'fDest',
] as const;

function numberOrNull(raw: string | undefined): number | null {
  if (raw === undefined || raw.trim() === '') return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

function isOn(raw: string | undefined): boolean {
  return raw === 'on' || raw === 'true';
}

/** `2026-06-10..2026-06-15`. Anything else is not a date filter. */
const DATE_WINDOW_PATTERN = /^\d{4}-\d{2}-\d{2}\.\.\d{4}-\d{2}-\d{2}$/;

/**
 * Read filters from query parameters.
 *
 * Anything unreadable is simply absent. A malformed filter must not narrow a
 * result set in a way nobody asked for, and it must not fail the page either -
 * the user would see an error where they expected trips.
 */
export function parseFilters(
  params: Readonly<Record<string, string | undefined>>,
  currency: string,
): ResultFilters {
  const maxTotalMajor = numberOrNull(params.fMaxTotal);
  const minTotalMajor = numberOrNull(params.fMinTotal);

  return {
    maxTotal:
      maxTotalMajor !== null && maxTotalMajor > 0 ? fromMajor(maxTotalMajor, currency) : null,
    minTotal:
      minTotalMajor !== null && minTotalMajor > 0 ? fromMajor(minTotalMajor, currency) : null,
    directOnly: isOn(params.fDirect),
    maxStops: numberOrNull(params.fMaxStops),
    departAfterHour: numberOrNull(params.fDepartAfter),
    departBeforeHour: numberOrNull(params.fDepartBefore),
    returnAfterHour: numberOrNull(params.fReturnAfter),
    returnBeforeHour: numberOrNull(params.fReturnBefore),
    arriveBeforeHour: numberOrNull(params.fArriveBefore),
    freeCancellationOnly: isOn(params.fFreeCancel),
    minReviewScore: numberOrNull(params.fMinReview),
    excludeSelfTransfer: isOn(params.fNoSelfTransfer),
    requirePricedTransfer: isOn(params.fTransferPriced),
    dates: DATE_WINDOW_PATTERN.test(params.fDates ?? '') ? (params.fDates as string) : null,
    destination: /^[A-Za-z]{3}$/.test(params.fDest ?? '')
      ? (params.fDest as string).toUpperCase()
      : null,
  };
}

export function hasActiveFilters(filters: ResultFilters): boolean {
  return (
    filters.maxTotal !== null ||
    filters.minTotal !== null ||
    filters.directOnly ||
    filters.maxStops !== null ||
    filters.departAfterHour !== null ||
    filters.departBeforeHour !== null ||
    filters.returnAfterHour !== null ||
    filters.returnBeforeHour !== null ||
    filters.arriveBeforeHour !== null ||
    filters.freeCancellationOnly ||
    filters.minReviewScore !== null ||
    filters.excludeSelfTransfer ||
    filters.requirePricedTransfer ||
    filters.dates !== null ||
    filters.destination !== null
  );
}

/**
 * Whether this trip's outbound flight states when it lands.
 *
 * A cached-fare vendor gives a departure and a duration and no arrival, so the
 * adapter leaves the arrival equal to the departure rather than computing a
 * wall-clock sum across two time zones. Equal and a single segment is how that
 * looks; a real flight never lands the minute it leaves.
 */
export function arrivalKnown(trip: RankedTrip): boolean {
  const { segments } = trip.candidate.flight.outbound;
  const first = segments[0];
  const last = segments.at(-1);

  return Boolean(first && last && last.arrivesAt !== first.departsAt);
}

/** Whether any trip in the set states an arrival, i.e. whether "lands by" means anything. */
export function anyArrivalKnown(trips: readonly RankedTrip[]): boolean {
  return trips.some(arrivalKnown);
}

/** Connections on the busier leg: what "two stops" means to a traveller. */
function stopsOf(trip: RankedTrip): number {
  const { outbound, inbound } = trip.candidate.flight;

  return Math.max(connectionCount(outbound), connectionCount(inbound));
}

/**
 * Whether one trip survives the filters.
 *
 * An unknown fact never silently fails a filter. A hotel with no review score
 * is not "below 8", and a flight that did not say whether it is self-transfer
 * is not "not self-transfer" - those are the `null`s the provenance work
 * introduced, and a filter that treated them as answers would reintroduce
 * exactly the confident guess it removed.
 */
export function matchesFilters(trip: RankedTrip, filters: ResultFilters): boolean {
  if (filters.maxTotal && greaterThan(trip.cost.total, filters.maxTotal)) return false;
  if (filters.minTotal && lessThan(trip.cost.total, filters.minTotal)) return false;

  const stops = stopsOf(trip);
  if (filters.directOnly && stops > 0) return false;
  if (filters.maxStops !== null && stops > filters.maxStops) return false;

  const { outbound, inbound } = trip.candidate.flight;

  if (filters.departAfterHour !== null) {
    const departsAt = outbound.segments[0]?.departsAt;
    if (!departsAt || localHour(departsAt) < filters.departAfterHour) return false;
  }

  if (filters.departBeforeHour !== null) {
    const departsAt = outbound.segments[0]?.departsAt;
    if (!departsAt || localHour(departsAt) >= filters.departBeforeHour) return false;
  }

  // The return flight leaves the destination, so its hour is that airport's.
  if (filters.returnAfterHour !== null) {
    const departsAt = inbound.segments[0]?.departsAt;
    if (!departsAt || localHour(departsAt) < filters.returnAfterHour) return false;
  }

  if (filters.returnBeforeHour !== null) {
    const departsAt = inbound.segments[0]?.departsAt;
    if (!departsAt || localHour(departsAt) >= filters.returnBeforeHour) return false;
  }

  // A provider that did not state when the flight lands has not said it lands
  // late, so an arrival filter cannot remove its trips - and the control is
  // not offered for it. See `anyArrivalKnown`.
  if (filters.arriveBeforeHour !== null && arrivalKnown(trip)) {
    const arrivesAt = outbound.segments.at(-1)?.arrivesAt;
    if (!arrivesAt || localHour(arrivesAt) > filters.arriveBeforeHour) return false;
  }

  if (filters.freeCancellationOnly && !trip.candidate.hotel.freeCancellation) return false;

  if (filters.minReviewScore !== null) {
    const score = trip.candidate.hotel.reviewScore;
    // Unrated is not "below the bar"; it is unknown, and the user asked for a
    // score they could rely on.
    if (score === null || score < filters.minReviewScore) return false;
  }

  if (filters.excludeSelfTransfer) {
    // Only a confirmed `false` passes. `null` means the provider did not say,
    // which is not the same as "no".
    if (outbound.selfTransfer !== false || inbound.selfTransfer !== false) return false;
  }

  if (filters.requirePricedTransfer && !trip.candidate.transfer) return false;

  if (filters.dates !== null) {
    const { departureDate, returnDate } = trip.candidate.dates;
    if (`${departureDate}..${returnDate}` !== filters.dates) return false;
  }

  if (filters.destination !== null && trip.candidate.destination !== filters.destination) {
    return false;
  }

  return true;
}

export interface FilteredResults {
  readonly trips: readonly RankedTrip[];
  /** How many the filters removed, so the page can say so. */
  readonly hidden: number;
}

export function applyFilters(
  trips: readonly RankedTrip[],
  filters: ResultFilters,
): FilteredResults {
  const kept = trips.filter((trip) => matchesFilters(trip, filters));

  return { trips: kept, hidden: trips.length - kept.length };
}

/**
 * How the trips are ordered on the page.
 *
 * Not a filter: it drops nothing, so it is not in `ResultFilters` and does not
 * count towards "your filters hid every trip". `cheapest` is the default
 * because the first thing a person comparing trips wants is the lowest total;
 * `best` is the engine's own score order and `fastest` is the shortest time in
 * the air. Each reads a figure the engines already computed.
 */
export type ResultSort = 'cheapest' | 'best' | 'fastest';

export const RESULT_SORTS: readonly { value: ResultSort; label: string }[] = [
  { value: 'cheapest', label: 'Cheapest' },
  { value: 'best', label: 'Best match' },
  { value: 'fastest', label: 'Fastest' },
];

export function parseSort(raw: string | undefined): ResultSort {
  return raw === 'best' || raw === 'fastest' || raw === 'cheapest' ? raw : 'cheapest';
}

/** A new array, stable: trips that tie keep the order the engine gave them. */
export function sortTrips(trips: readonly RankedTrip[], sort: ResultSort): RankedTrip[] {
  const indexed = trips.map((trip, index) => ({ trip, index }));

  const minutes = (trip: RankedTrip) =>
    trip.candidate.flight.outbound.durationMinutes + trip.candidate.flight.inbound.durationMinutes;

  const compare = (a: RankedTrip, b: RankedTrip): number => {
    if (sort === 'cheapest') {
      return lessThan(a.cost.total, b.cost.total)
        ? -1
        : lessThan(b.cost.total, a.cost.total)
          ? 1
          : 0;
    }
    if (sort === 'fastest') return minutes(a) - minutes(b);
    return 0;
  };

  return indexed.sort((x, y) => compare(x.trip, y.trip) || x.index - y.index).map((e) => e.trip);
}
