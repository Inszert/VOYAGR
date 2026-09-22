import {
  MoneyError,
  minorUnitExponent,
  money,
  type CurrencyCode,
  type Money,
  type RoundingMode,
} from './money';
import type { IsoDateTime } from './trip/types';

/**
 * Converting money between currencies, without ever inventing a rate.
 *
 * A live provider quotes in whatever currency it feels like. Today a response
 * whose currency differs from the search's yields no results and one
 * diagnostic, which reads to a user as "no trips found" - a wrong answer
 * dressed as an empty one. This is the layer that makes the right answer
 * possible.
 *
 * **Two rules, and neither bends.**
 *
 * 1. *A rate is data, never a guess.* There is no default rate, no identity
 *    fallback between different currencies, no "close enough" pair. A
 *    conversion with no rate for it fails, loudly and specifically, and the
 *    caller decides what to tell the user. A made-up rate is a made-up price,
 *    and a made-up price is the one thing this product cannot ship.
 * 2. *A rate has an age.* Every rate carries the instant it was observed, the
 *    same as every offer does, so a conversion can be refused or labelled
 *    when the rate behind it is too old to stand behind. See `src/core/freshness.ts`.
 *
 * Where the rates come from is deliberately not decided here. `RateSource` is
 * the seam: a table of fixed rates for tests and for the deterministic mocks,
 * and a real feed behind the same interface whenever one is chosen. Nothing
 * in this file knows which it is talking to.
 */

/** A rate for one ordered pair, and when it was true. */
export interface ExchangeRate {
  readonly from: CurrencyCode;
  readonly to: CurrencyCode;
  /**
   * How many units of `to` one unit of `from` buys, in major units.
   *
   * Major units on both sides, so the number reads the way a rate is quoted
   * everywhere else - 1 EUR = 1.0850 USD is `1.085`, whatever minor-unit
   * exponents the two currencies happen to have. The exponent difference is
   * applied by `convert`, which is the only place it should ever be.
   */
  readonly rate: number;
  readonly observedAt: IsoDateTime;
}

/**
 * Somewhere rates come from.
 *
 * Deliberately narrow: given an ordered pair, either there is a rate or there
 * is not. No list, no "nearest pair", no triangulation through a base
 * currency unless an implementation chooses to do that internally and can
 * stand behind the result - see `crossVia` for the one supported way to do
 * that honestly.
 *
 * Synchronous on purpose. A conversion happens inside costing and ranking,
 * which are pure and deterministic, and an `await` in there would make them
 * neither. Fetching rates is I/O and belongs above this layer: load a table,
 * then convert against it.
 */
export interface RateSource {
  /** The rate for this pair, or null if this source does not have one. */
  rateFor(from: CurrencyCode, to: CurrencyCode): ExchangeRate | null;
}

export type ConversionFailure =
  /** No rate for this pair, from any source given. */
  | { readonly reason: 'no_rate'; readonly from: CurrencyCode; readonly to: CurrencyCode }
  /** A rate exists but is older than the caller is willing to accept. */
  | {
      readonly reason: 'stale_rate';
      readonly from: CurrencyCode;
      readonly to: CurrencyCode;
      readonly observedAt: IsoDateTime;
    };

export type ConversionResult =
  | { readonly ok: true; readonly value: Money; readonly rate: ExchangeRate }
  | { readonly ok: false; readonly failure: ConversionFailure };

export interface ConvertOptions {
  /**
   * Reject a rate observed before this instant.
   *
   * Left out, age is not checked here - the caller may still read
   * `result.rate.observedAt` and decide for itself. Passed, a rate older than
   * this fails as `stale_rate` rather than quietly pricing a trip off last
   * week's currency market.
   */
  readonly notBefore?: IsoDateTime;
  /**
   * How the converted minor units are rounded.
   *
   * `half-even` by default, not `half-up`. Converting is not a one-off tax
   * calculation; a search converts hundreds of prices and ranks them against
   * each other, and half-up biases every one of them upward by half a minor
   * unit on average. Banker's rounding has no such drift, which is why it is
   * the convention for exactly this job.
   */
  readonly rounding?: RoundingMode;
}

/** A rate source backed by a fixed table. Deterministic, and never guesses. */
export function fixedRates(rates: readonly ExchangeRate[]): RateSource {
  const table = new Map<string, ExchangeRate>();

  for (const rate of rates) {
    assertUsableRate(rate);
    table.set(pairKey(rate.from, rate.to), rate);
  }

  return {
    rateFor: (from, to) => table.get(pairKey(from, to)) ?? null,
  };
}

/**
 * Try each source in order and take the first that has the pair.
 *
 * Order is preference: a live feed in front of a committed fallback table
 * reads exactly as it should. There is no averaging and no reconciliation -
 * two sources disagreeing about a rate is not something to split the
 * difference on.
 */
export function firstOf(sources: readonly RateSource[]): RateSource {
  return {
    rateFor(from, to) {
      for (const source of sources) {
        const rate = source.rateFor(from, to);
        if (rate) return rate;
      }

      return null;
    },
  };
}

/**
 * Derive `from -> to` by going through a base currency.
 *
 * The one honest way to answer a pair a source does not hold directly: if it
 * knows EUR->USD and EUR->GBP then USD->GBP follows arithmetically. Offered
 * as an explicit wrapper rather than done silently inside `convert`, because
 * a cross rate is a weaker fact than a quoted one - it compounds two
 * observations and two spreads - and a caller should be choosing it.
 *
 * The derived rate is dated with the **older** of the two legs. A cross rate
 * is only as fresh as its staler half, and claiming otherwise would let a
 * stale leg hide behind a fresh one.
 */
export function crossVia(base: CurrencyCode, source: RateSource): RateSource {
  const root = base.toUpperCase();

  return {
    rateFor(from, to) {
      const direct = source.rateFor(from, to);
      if (direct) return direct;

      const start = from.toUpperCase();
      const end = to.toUpperCase();

      // Nothing to derive: one leg would be the pair itself.
      if (start === root || end === root) return null;

      const inbound = source.rateFor(start, root);
      const outbound = source.rateFor(root, end);
      if (!inbound || !outbound) return null;

      return {
        from: start,
        to: end,
        rate: inbound.rate * outbound.rate,
        observedAt:
          inbound.observedAt < outbound.observedAt ? inbound.observedAt : outbound.observedAt,
      };
    },
  };
}

/**
 * Convert an amount into `target`.
 *
 * Same currency in and out is the identity, and is the **only** case that
 * needs no rate. Every other pair needs one, including a pair a human would
 * call obvious.
 */
export function convert(
  value: Money,
  target: CurrencyCode,
  source: RateSource,
  options: ConvertOptions = {},
): ConversionResult {
  const to = normalise(target);
  const from = value.currency;

  if (from === to) {
    return {
      ok: true,
      value,
      rate: { from, to, rate: 1, observedAt: '1970-01-01T00:00:00Z' as IsoDateTime },
    };
  }

  const rate = source.rateFor(from, to);
  if (!rate) return { ok: false, failure: { reason: 'no_rate', from, to } };

  assertUsableRate(rate);

  if (options.notBefore !== undefined && rate.observedAt < options.notBefore) {
    return {
      ok: false,
      failure: { reason: 'stale_rate', from, to, observedAt: rate.observedAt },
    };
  }

  /*
   * Minor units across, in one rounding.
   *
   * The rate is quoted in major units, so converting minor units needs the
   * exponent difference applied as well: 100 JPY (exponent 0) into EUR
   * (exponent 2) is `100 x rate x 10^2`. Doing it as a single multiplication
   * and rounding once at the end is what keeps a hundred conversions from
   * accumulating a hundred separate rounding errors.
   */
  const exponentShift = 10 ** (minorUnitExponent(to) - minorUnitExponent(from));
  const converted = value.amount * rate.rate * exponentShift;

  if (!Number.isFinite(converted)) {
    throw new MoneyError(
      `Converting ${value.amount} ${from} to ${to} at ${rate.rate} produced a non-finite amount`,
    );
  }

  return {
    ok: true,
    value: money(round(converted, options.rounding ?? 'half-even'), to),
    rate,
  };
}

function pairKey(from: CurrencyCode, to: CurrencyCode): string {
  return `${normalise(from)}>${normalise(to)}`;
}

function normalise(currency: CurrencyCode): CurrencyCode {
  return currency.toUpperCase();
}

/**
 * A rate that cannot be used is a bug where it was published, not here.
 *
 * Zero, negative and non-finite rates all produce a price, and every one of
 * them would be wrong in a way nobody downstream could detect. Thrown rather
 * than returned: a caller can reasonably handle "no rate for this pair", but
 * "this rate is nonsense" is not a condition to degrade around.
 */
function assertUsableRate(rate: ExchangeRate): void {
  if (!Number.isFinite(rate.rate) || rate.rate <= 0) {
    throw new MoneyError(
      `Exchange rate ${rate.from}->${rate.to} must be a positive finite number, received ${rate.rate}`,
    );
  }
}

/** The same rounding modes `money.ts` uses, applied to a converted amount. */
function round(value: number, mode: RoundingMode): number {
  switch (mode) {
    case 'ceil':
      return Math.ceil(value);
    case 'floor':
      return Math.floor(value);
    case 'trunc':
      return Math.trunc(value);
    case 'half-even': {
      const rounded = Math.round(value);

      // Exactly halfway: Math.round always goes up, which is the bias this
      // mode exists to remove. Take the even neighbour instead.
      if (Math.abs(value % 1) === 0.5 && rounded % 2 !== 0) return rounded - 1;

      return rounded;
    }
    case 'half-up':
    default:
      return Math.round(value);
  }
}
