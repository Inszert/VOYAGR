import type { IsoDateTime } from './trip/types';

/**
 * How old an observation is, and whether that is acceptable.
 *
 * Every offer carries `observedAt` - the instant a provider said this price
 * was true - and until now nothing read it. A quote is a perishable fact: a
 * flight price from four hours ago is a different claim from one taken a
 * moment ago, and showing both as "the price" is the kind of silent surprise
 * §31.5 exists to prevent.
 *
 * **Three outcomes, not two.** `unknown` is its own case and never collapses
 * into `stale`. A provider that did not say when it looked has told us
 * nothing, and treating silence as "old" is a claim we cannot support in
 * exactly the same way treating it as "fresh" would be. This follows the rule
 * the rest of the domain already holds: an unstated fact is `null`, gets its
 * own branch, and lands in the No-Surprise check rather than being guessed.
 */

export type Freshness = 'fresh' | 'stale' | 'unknown';

/**
 * A parsed instant, or null when the value is not one.
 *
 * `Date.parse` is right here and wrong for a calendar date. An `IsoDateTime`
 * is a real instant in UTC, so turning it into milliseconds is exactly what
 * it is for - unlike a `YYYY-MM-DD`, which `src/core/dates.ts` keeps as a
 * string precisely so that no timezone ever touches it.
 */
export function instantOf(value: IsoDateTime | null | undefined): number | null {
  if (typeof value !== 'string' || value.length === 0) return null;

  const parsed = Date.parse(value);

  return Number.isFinite(parsed) ? parsed : null;
}

export interface FreshnessLimits {
  /**
   * How old an observation may be before it is stale, in milliseconds.
   *
   * There is no default. The tolerable age of a flight quote, a hotel quote
   * and an exchange rate are three different numbers, and a shared default
   * would be wrong for at least two of them.
   */
  readonly maxAgeMs: number;
  /**
   * How far into the future an observation may sit before it is not believed.
   *
   * Clock skew between us and a vendor is normal and small; a timestamp an
   * hour ahead is not skew, it is a bug or a timezone mapped wrongly, and
   * calling that "fresh" would make the freshest-looking data the least
   * trustworthy. Defaults to a minute.
   */
  readonly toleranceMs?: number;
}

const DEFAULT_TOLERANCE_MS = 60_000;

/**
 * Whether an observation is fresh, stale, or not dated at all.
 *
 * `now` is passed in rather than read from the clock, because this is core:
 * pure, and the same inputs must always give the same answer.
 */
export function freshnessOf(
  observedAt: IsoDateTime | null | undefined,
  now: number,
  limits: FreshnessLimits,
  /**
   * When the vendor said the price stops holding, if it said. Past it, the
   * quote is stale however young it is. Before it, the age limit still
   * applies: a vendor's promise never makes an old observation fresh.
   */
  expiresAt?: IsoDateTime | null,
): Freshness {
  const observed = instantOf(observedAt);
  if (observed === null) return 'unknown';

  const tolerance = limits.toleranceMs ?? DEFAULT_TOLERANCE_MS;

  // Further ahead than skew explains: not believed, and not quietly treated
  // as the freshest thing on the page.
  if (observed > now + tolerance) return 'unknown';

  const expires = instantOf(expiresAt);
  if (expires !== null && now >= expires) return 'stale';

  return now - observed <= limits.maxAgeMs ? 'fresh' : 'stale';
}

/** How old an observation is in milliseconds, or null when it is not dated. */
export function ageOf(observedAt: IsoDateTime | null | undefined, now: number): number | null {
  const observed = instantOf(observedAt);

  return observed === null ? null : now - observed;
}

/**
 * The weakest freshness in a set.
 *
 * A trip is priced from several observations - a flight, a hotel, a transfer,
 * maybe an exchange rate - and it can only be as current as the oldest of
 * them. `unknown` outranks `stale`, because a figure we cannot date is a
 * weaker claim than one we can date and know to be old.
 */
export function weakestFreshness(values: readonly Freshness[]): Freshness {
  if (values.includes('unknown')) return 'unknown';
  if (values.includes('stale')) return 'stale';

  return 'fresh';
}

/** The 12-hour rule for flight data. */
export const FLIGHT_MAX_AGE_MS = 12 * 60 * 60_000;

/**
 * The honest age label: "checked 14 h ago". Whole hours, rounded down; under
 * an hour it says so rather than claiming a minute count the data does not
 * deserve. A missing age is its own wording, never "just now".
 */
export function checkedAgoLabel(ageMs: number | null): string {
  if (ageMs === null || !Number.isFinite(ageMs)) return 'check time unknown';
  const hours = Math.floor(Math.max(0, ageMs) / 3_600_000);
  return hours < 1 ? 'checked less than 1 h ago' : `checked ${hours} h ago`;
}

/**
 * How long a quote of each kind may be trusted.
 *
 * Numbers chosen against how fast each thing actually moves, and every one of
 * them is a guess until a vendor states its own validity window - which is
 * one of the things the live-provider readiness gate asks to be confirmed.
 * They live here, named, so that confirming them is editing one block.
 */
export const DEFAULT_FRESHNESS: Record<'flights' | 'hotels' | 'transfers' | 'fx', FreshnessLimits> =
  {
    // A flight price is refreshed only when it is older than 12 hours AND
    // someone asked for it. It is shown as "checked N h ago" (see
    // `checkedAgoLabel`), never as a live price.
    flights: { maxAgeMs: FLIGHT_MAX_AGE_MS },
    // Nightly rates move more slowly, and availability is the volatile part.
    hotels: { maxAgeMs: 60 * 60_000 },
    // A transfer is a rate card more than a quote.
    transfers: { maxAgeMs: 24 * 60 * 60_000 },
    // A daily reference rate is fine for ranking trips; an intraday one is
    // not needed to tell a cheap trip from an expensive one.
    fx: { maxAgeMs: 36 * 60 * 60_000 },
  };
