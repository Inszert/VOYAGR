import { isIsoDate } from '@/core/dates';

/**
 * A plain link to a live Aviasales search for one route and one pair of dates.
 *
 * The path shape is the one the vendor itself builds for every fare it returns.
 * In the recorded Travelpayouts responses (`tests/fixtures/providers/`) each
 * `price.link` is `/search/<ORIGIN><DDMM><DEST><DDMM><passengers>`, for example
 * `/search/VIE1112FCO12121` - Vienna out on 11 December, Rome back on 12 December,
 * one passenger. The fare links add a `t=` tracking token and fare keys; this
 * builder leaves those out, so the link opens the route and dates, not one fare.
 *
 * Two things this format cannot say, and the caller must know:
 *
 * - **The year is not in the path.** Only day and month are. Aviasales reads the
 *   year from the date it is opened on, so a link is only right for a trip that
 *   falls within the next year. This is a pure function with no clock, so it
 *   cannot check that for you.
 * - **The partner marker is not in the recorded search links.** The adapter sends
 *   `marker` on its API calls. The public link carries it as a `marker` query
 *   parameter here, which is the Travelpayouts convention; that placement has not
 *   been confirmed against a live search and is the first thing to check if
 *   attribution is ever in doubt.
 *
 * Anything malformed returns `null`, never a guessed link. Money is not involved.
 */

export interface AviasalesSearchInput {
  /** IATA airport or city code, three capital letters. */
  readonly origin: string;
  /** IATA airport or city code, three capital letters. */
  readonly destination: string;
  /** Calendar date of the outbound flight, `YYYY-MM-DD`. */
  readonly departureDate: string;
  /** Calendar date of the return flight, `YYYY-MM-DD`, not before the departure. */
  readonly returnDate: string;
  /** Adults on the search, a whole number from 1 to 9. */
  readonly passengers: number;
  /**
   * The Travelpayouts partner marker, from `AVIASALES_PARTNER_ID`. Absent, null
   * or empty means the link carries no marker. A value that is not a plain
   * alphanumeric identifier makes the whole link `null`, rather than being
   * dropped without a trace.
   */
  readonly marker?: string | null | undefined;
}

const SEARCH_BASE = 'https://www.aviasales.com/search/';
const IATA_CODE = /^[A-Z]{3}$/;
const MARKER = /^[A-Za-z0-9]{1,32}$/;
const MIN_PASSENGERS = 1;
const MAX_PASSENGERS = 9;

/** `2026-11-25` becomes `2511`: day then month, as the vendor writes it. */
function dayMonth(isoDate: string): string {
  return `${isoDate.slice(8, 10)}${isoDate.slice(5, 7)}`;
}

export function aviasalesSearchUrl(input: AviasalesSearchInput): string | null {
  if (typeof input !== 'object' || input === null) return null;

  const { origin, destination, departureDate, returnDate, passengers, marker } = input;

  if (typeof origin !== 'string' || !IATA_CODE.test(origin)) return null;
  if (typeof destination !== 'string' || !IATA_CODE.test(destination)) return null;
  if (origin === destination) return null;

  if (typeof departureDate !== 'string' || !isIsoDate(departureDate)) return null;
  if (typeof returnDate !== 'string' || !isIsoDate(returnDate)) return null;
  // ISO dates of the same shape compare correctly as strings, and this avoids
  // parsing them into a Date.
  if (returnDate < departureDate) return null;

  if (
    typeof passengers !== 'number' ||
    !Number.isInteger(passengers) ||
    passengers < MIN_PASSENGERS ||
    passengers > MAX_PASSENGERS
  ) {
    return null;
  }

  const url = new URL(
    `${origin}${dayMonth(departureDate)}${destination}${dayMonth(returnDate)}${passengers}`,
    SEARCH_BASE,
  );

  if (marker !== undefined && marker !== null && marker !== '') {
    if (typeof marker !== 'string' || !MARKER.test(marker)) return null;
    url.searchParams.set('marker', marker);
  }

  return url.toString();
}
