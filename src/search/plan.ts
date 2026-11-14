import { addDays, dayOfWeek, daysBetween, isIsoDate } from '@/core/dates';
import { AppError } from '@/lib/errors';
import type { AirportCode, SearchProfile } from '@/core/trip/types';
import {
  DEFAULT_SEARCH_LIMITS,
  type DateWindow,
  type SearchLimits,
  type SearchPlan,
  type SearchRequest,
} from './types';

/**
 * Search planning.
 *
 * Decides what will be asked of the providers before anything is asked. Pure and
 * deterministic: the same request always produces the same plan, which is what
 * makes a background Travel Watch refresh comparable to the search that created
 * it.
 *
 * The plan is also where the combinatorial explosion is stopped. A profile that
 * allows 30 departure dates and 6 trip lengths describes 165 date windows; this
 * module reduces that to a bounded, evenly spread sample and records how many it
 * dropped.
 */

function requireValid(condition: boolean, message: string, publicMessage: string): void {
  if (condition) return;
  throw new AppError('VALIDATION_ERROR', message, { publicMessage });
}

function resolveLimits(overrides: Partial<SearchLimits> | undefined): SearchLimits {
  const limits: SearchLimits = { ...DEFAULT_SEARCH_LIMITS, ...overrides };

  // Limits that may be turned off with zero. Every other one is a ceiling, and
  // a ceiling of zero is a search that can find nothing.
  const MAY_BE_ZERO: ReadonlySet<string> = new Set(['calendarCoverageDays']);

  for (const [key, value] of Object.entries(limits)) {
    const floor = MAY_BE_ZERO.has(key) ? 0 : 1;

    requireValid(
      Number.isSafeInteger(value) && value >= floor,
      `Search limit ${key} must be ${floor === 0 ? 'a whole number, zero or more' : 'a positive integer'}, received ${value}`,
      'The search settings were not valid.',
    );
  }

  return limits;
}

/** Uppercase, de-duplicate and cap a list of airport codes, keeping caller order. */
function normaliseAirports(codes: readonly AirportCode[], limit: number): AirportCode[] {
  const seen = new Set<AirportCode>();

  for (const code of codes) {
    const normalised = code.trim().toUpperCase();
    if (normalised.length > 0) seen.add(normalised);
  }

  return [...seen].slice(0, limit);
}

/**
 * Every departure/return pair the profile allows.
 *
 * Enumerated departure-first so that the sampling below spreads across the
 * whole window rather than favouring one trip length.
 *
 * `departureDaysOfWeek` and `returnDaysOfWeek` narrow this rather than the
 * window does: "a long weekend in June" is the whole of June plus a rule about
 * which days count, and expressing it as a shorter window would either miss
 * most of the weekends or admit the Tuesdays between them.
 */
export function enumerateDateWindows(profile: SearchProfile): DateWindow[] {
  const windows: DateWindow[] = [];
  const lastDeparture = addDays(profile.latestReturn, -profile.minNights);

  for (
    let departureDate = profile.earliestDeparture;
    departureDate <= lastDeparture;
    departureDate = addDays(departureDate, 1)
  ) {
    if (
      profile.departureDaysOfWeek !== null &&
      !profile.departureDaysOfWeek.includes(dayOfWeek(departureDate))
    ) {
      continue;
    }

    for (let nights = profile.minNights; nights <= profile.maxNights; nights += 1) {
      const returnDate = addDays(departureDate, nights);
      if (returnDate > profile.latestReturn) break;

      // `continue`, not `break`: a later trip length may land on an allowed
      // return day even when this one did not.
      if (
        profile.returnDaysOfWeek !== null &&
        !profile.returnDaysOfWeek.includes(dayOfWeek(returnDate))
      ) {
        continue;
      }

      windows.push({ departureDate, returnDate, nights });
    }
  }

  return windows;
}

/**
 * Reduce a list to at most `limit` entries, evenly spread.
 *
 * Truncating instead would search only the first week of a month-long window,
 * which is a worse answer disguised as a cheaper one. Stride sampling keeps the
 * first and last entries and spaces the rest, so a flexible search stays
 * flexible.
 */
export function sampleEvenly<T>(items: readonly T[], limit: number): T[] {
  if (items.length <= limit) return [...items];
  if (limit === 1) return [items[0] as T];

  const sampled: T[] = [];
  const seen = new Set<number>();

  for (let step = 0; step < limit; step += 1) {
    const index = Math.round((step * (items.length - 1)) / (limit - 1));
    if (seen.has(index)) continue;
    seen.add(index);
    sampled.push(items[index] as T);
  }

  return sampled;
}

/**
 * Build the plan for a request.
 *
 * @throws AppError VALIDATION_ERROR when the profile cannot describe any trip -
 *   an eight-night minimum inside a five-day window is a mistake worth naming,
 *   not an empty result set to puzzle over.
 */
export function buildSearchPlan(request: SearchRequest): SearchPlan {
  const { profile } = request;
  const limits = resolveLimits(request.limits);

  requireValid(
    Number.isSafeInteger(profile.passengers) && profile.passengers > 0,
    `passengers must be a positive integer, received ${profile.passengers}`,
    'The number of travellers was not valid.',
  );

  requireValid(
    Number.isSafeInteger(profile.minNights) && profile.minNights > 0,
    `minNights must be a positive integer, received ${profile.minNights}`,
    'The minimum trip length was not valid.',
  );

  requireValid(
    Number.isSafeInteger(profile.maxNights) && profile.maxNights >= profile.minNights,
    `maxNights (${profile.maxNights}) must be a whole number no smaller than minNights (${profile.minNights})`,
    'The maximum trip length must be at least the minimum.',
  );

  requireValid(
    isIsoDate(profile.earliestDeparture) && isIsoDate(profile.latestReturn),
    `Invalid travel window: ${profile.earliestDeparture} to ${profile.latestReturn}`,
    'The travel dates were not valid.',
  );

  requireValid(
    daysBetween(profile.earliestDeparture, profile.latestReturn) >= profile.minNights,
    `The travel window ${profile.earliestDeparture}..${profile.latestReturn} is shorter than the ${profile.minNights} night minimum`,
    'The travel window is shorter than the minimum trip length.',
  );

  // Mixing currencies in a budget would surface much later as a cost-engine
  // throw on an unrelated line, so it is caught at the door instead.
  const currency = profile.targetBudget.currency;
  requireValid(
    profile.maxBudget.currency === currency &&
      (profile.reserveBudget === null || profile.reserveBudget.currency === currency),
    `Budget currencies differ: target ${currency}, max ${profile.maxBudget.currency}`,
    'The budget amounts must all use the same currency.',
  );

  const origins = normaliseAirports(profile.origins, limits.maxOrigins);
  requireValid(
    origins.length > 0,
    'A search needs at least one departure airport',
    'Choose at least one departure airport.',
  );

  const destinations = normaliseAirports(request.destinations, limits.maxDestinations);
  requireValid(
    destinations.length > 0,
    'A search needs at least one destination airport',
    'Choose at least one destination.',
  );

  const available = enumerateDateWindows(profile);
  const dayRule =
    profile.departureDaysOfWeek !== null || profile.returnDaysOfWeek !== null
      ? ' on the days of the week chosen'
      : '';
  requireValid(
    available.length > 0,
    `No trip of ${profile.minNights}-${profile.maxNights} nights fits between ${profile.earliestDeparture} and ${profile.latestReturn}${dayRule}`,
    dayRule
      ? 'No trip of that length fits inside those dates on the days you chose.'
      : 'No trip of that length fits inside those dates.',
  );

  const dateWindows = sampleEvenly(available, limits.maxDateWindows);

  return {
    origins,
    destinations,
    dateWindows,
    dateWindowsAvailable: available.length,
    originsRequested: profile.origins.length,
    destinationsRequested: request.destinations.length,
    currency,
    passengers: profile.passengers,
    // Taken from the sampled windows rather than from the profile: weather and
    // transfers are fetched across exactly the span that will be priced, not
    // across a window whose edges were sampled away.
    earliestDate: dateWindows.reduce(
      (earliest, window) => (window.departureDate < earliest ? window.departureDate : earliest),
      profile.latestReturn,
    ),
    latestDate: dateWindows.reduce(
      (latest, window) => (window.returnDate > latest ? window.returnDate : latest),
      profile.earliestDeparture,
    ),
    limits,
  };
}
