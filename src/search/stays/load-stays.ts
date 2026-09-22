import { addDays, isIsoDate } from '@/core/dates';
import { bestRateFor, compareAgainst, ratesOf, type PriceComparison } from '@/core/stay/comparison';
import type { CanonicalStay } from '@/core/stay/identity';
import { nightsIn, type StayQuery, type StayRate } from '@/core/stay/types';
import type { IsoDate } from '@/core/trip/types';
import { createLimiter } from '@/lib/concurrency';
import { getStayProviders } from '@/providers/stays/registry';
import type { DataSource } from '@/providers/data-source';
import { searchAllStays, type StayFanoutFailure } from '@/providers/stays/fanout';
import { exploreStayDates, type StayDatePrice } from './calendar';

/**
 * The stay search, as a function of the URL.
 *
 * Every state of the flow is a query string - the destination, the dates,
 * whether they are confirmed, which property is open, which rate is the
 * comparison reference. That is the same rule the trip search follows, and
 * it is what makes the back button, a bookmark and a shared link all behave.
 *
 * The flow is deliberately ordered: **dates before hotels**. Showing a list
 * of properties before somebody has seen what their dates cost invites them
 * to choose a hotel and then discover the week was the expensive one.
 */

export type StayStep = 'dates' | 'results' | 'property';

export interface StayViewModel {
  readonly step: StayStep;
  readonly query: StayQuery;
  readonly nights: number;
  /** Populated on the `dates` step. */
  readonly calendar: readonly StayDatePrice[];
  /** Populated once the dates are confirmed. */
  readonly stays: readonly CanonicalStay[];
  /** The property being looked at, on the `property` step. */
  readonly openStay: CanonicalStay | null;
  /** Every rate for the open property, compared against the reference. */
  readonly comparison: readonly PriceComparison[];
  /** The rate comparisons are measured from. */
  readonly reference: StayRate | null;
  readonly failures: readonly StayFanoutFailure[];
  /** Providers that answered, for the provenance line. */
  readonly answered: readonly string[];
  readonly errors: Readonly<Record<string, string>>;
}

export type StayParams = Readonly<Record<string, string | undefined>>;

/** A positive integer from a query string, clamped to something sane. */
function count(value: string | undefined, fallback: number, max: number): number {
  const parsed = Number.parseInt(value ?? '', 10);

  if (!Number.isSafeInteger(parsed) || parsed < 0) return fallback;

  return Math.min(parsed, max);
}

/**
 * Build the query, repairing what is repairable and reporting what is not.
 *
 * A bad date in a URL is not an exception - somebody edited a link, or a
 * bookmark aged past its own check-in. The search falls back to a sensible
 * window and says so, rather than showing an error page for a typo.
 */
export function parseStayParams(
  params: StayParams,
  today: IsoDate,
): { query: StayQuery; errors: Record<string, string> } {
  const errors: Record<string, string> = {};

  const rawCheckIn = params.checkIn;
  const rawCheckOut = params.checkOut;

  let checkIn = isIsoDate(rawCheckIn ?? '') ? (rawCheckIn as IsoDate) : addDays(today, 30);
  if (rawCheckIn && !isIsoDate(rawCheckIn)) errors.checkIn = 'That check-in date is not a date.';

  let checkOut = isIsoDate(rawCheckOut ?? '') ? (rawCheckOut as IsoDate) : addDays(checkIn, 4);
  if (rawCheckOut && !isIsoDate(rawCheckOut)) {
    errors.checkOut = 'That check-out date is not a date.';
  }

  // A stay has to last at least one night, whatever the URL says.
  if (checkOut <= checkIn) {
    checkOut = addDays(checkIn, 1);
    if (rawCheckOut) errors.checkOut = 'Check-out has to be after check-in.';
  }

  // And nobody is booking last century.
  if (checkIn < today) {
    checkIn = addDays(today, 30);
    checkOut = addDays(checkIn, 4);
    if (rawCheckIn) errors.checkIn = 'That date has passed, so these are the next available.';
  }

  const destinationName = (params.destination ?? '').trim();

  return {
    errors,
    query: {
      destination: {
        code: (params.destinationCode ?? '').trim().toUpperCase() || null,
        name: destinationName || null,
        position: null,
        radiusKm: null,
      },
      checkIn,
      checkOut,
      occupancy: {
        adults: Math.max(1, count(params.adults, 2, 16)),
        children: count(params.children, 0, 10),
        rooms: Math.max(1, count(params.rooms, 1, 8)),
      },
      currency: (params.currency ?? 'EUR').toUpperCase(),
      maxResults: 20,
    },
  };
}

export async function loadStaySearch(
  params: StayParams,
  today: IsoDate,
  source: DataSource = 'api',
): Promise<StayViewModel> {
  const { query, errors } = parseStayParams(params, today);
  // Which vendors answer, chosen by the runtime data-source switch. `mock`
  // is the fixture list whatever is configured; `api` is the configuration.
  const providers = getStayProviders(undefined, source);

  const step: StayStep = params.property
    ? 'property'
    : params.dates === 'confirmed'
      ? 'results'
      : 'dates';

  /*
   * One limiter for the whole page.
   *
   * Date exploration is a fan-out of fan-outs - fifteen windows across every
   * provider - and it is the one place on this site that could turn a single
   * page view into a hundred vendor calls. The leaf call takes the slot; see
   * the rule in `concurrency.ts`.
   */
  const limiter = createLimiter(6);

  if (step === 'dates') {
    const calendar = await exploreStayDates(providers, query, { shiftDays: 3, limiter });

    return {
      step,
      query,
      nights: nightsIn(query),
      calendar,
      stays: [],
      openStay: null,
      comparison: [],
      reference: null,
      failures: [],
      answered: providers.map((provider) => provider.metadata.id),
      errors,
    };
  }

  const found = await searchAllStays(providers, query, { limiter });

  const openStay = params.property
    ? (found.stays.find((stay) => stay.key === params.property) ?? null)
    : null;

  /*
   * The reference is whatever the user picked, and only falls back to the
   * cheapest when they have picked nothing. Hardcoding one provider as the
   * baseline would quietly make every other provider look like the exception.
   */
  const rates = openStay ? ratesOf(openStay) : [];
  const reference =
    rates.find((rate) => rate.id === params.reference) ?? (openStay ? bestRateFor(openStay) : null);

  return {
    step: openStay ? 'property' : 'results',
    query,
    nights: nightsIn(query),
    calendar: [],
    stays: found.stays,
    openStay,
    comparison: reference ? compareAgainst(reference, rates) : [],
    reference,
    failures: found.failures,
    answered: found.answered,
    errors,
  };
}

/** The same params with one value changed, for a link that moves one step. */
export function stayHref(params: StayParams, changes: StayParams): string {
  const next = new URLSearchParams();

  for (const [key, value] of Object.entries({ ...params, ...changes })) {
    if (value !== undefined && value !== '') next.set(key, value);
  }

  return `/stays?${next.toString()}`;
}
