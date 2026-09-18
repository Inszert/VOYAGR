/**
 * Deterministic money arithmetic.
 *
 * Per the product specification (section 23), prices, totals and currency
 * calculations are the responsibility of deterministic software, never of the
 * language model. Everything in this module is pure and total: same inputs,
 * same outputs, no I/O, no clock, no randomness.
 *
 * Amounts are integers in the currency's *minor unit* (cents, pence, fillér).
 * Floating-point money is never stored or accumulated, because `0.1 + 0.2` is
 * not `0.3` and a trip total is the sum of a dozen such lines.
 */

/** ISO 4217 alphabetic code. Kept as a string so new currencies need no code change. */
export type CurrencyCode = string;

/** Minor-unit exponents for currencies that are not the 2-decimal default. */
const MINOR_UNIT_EXPONENTS: Readonly<Record<string, number>> = {
  BIF: 0,
  CLP: 0,
  DJF: 0,
  GNF: 0,
  ISK: 0,
  JPY: 0,
  KRW: 0,
  PYG: 0,
  RWF: 0,
  UGX: 0,
  VND: 0,
  VUV: 0,
  XAF: 0,
  XOF: 0,
  XPF: 0,
  BHD: 3,
  IQD: 3,
  JOD: 3,
  KWD: 3,
  LYD: 3,
  OMR: 3,
  TND: 3,
};

const DEFAULT_MINOR_UNIT_EXPONENT = 2;

export function minorUnitExponent(currency: CurrencyCode): number {
  return MINOR_UNIT_EXPONENTS[currency.toUpperCase()] ?? DEFAULT_MINOR_UNIT_EXPONENT;
}

export interface Money {
  /** Integer amount in the currency's minor unit. May be negative. */
  readonly amount: number;
  readonly currency: CurrencyCode;
}

export class MoneyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MoneyError';
  }
}

export type RoundingMode = 'half-up' | 'half-even' | 'ceil' | 'floor' | 'trunc';

function assertValidCurrency(currency: CurrencyCode): void {
  if (!/^[A-Za-z]{3}$/.test(currency)) {
    throw new MoneyError(`Invalid ISO 4217 currency code: ${JSON.stringify(currency)}`);
  }
}

/** Build a Money value from an integer amount of minor units. */
export function money(amount: number, currency: CurrencyCode): Money {
  assertValidCurrency(currency);

  if (!Number.isSafeInteger(amount)) {
    throw new MoneyError(
      `Money amount must be a safe integer number of minor units, received ${amount}`,
    );
  }

  return Object.freeze({ amount, currency: currency.toUpperCase() });
}

export function zero(currency: CurrencyCode): Money {
  return money(0, currency);
}

/**
 * Build Money from a major-unit value (e.g. `12.34` EUR).
 *
 * Only for parsing external input — provider responses, user-entered budgets.
 * Internal arithmetic always stays in minor units.
 */
export function fromMajor(
  value: number,
  currency: CurrencyCode,
  rounding: RoundingMode = 'half-up',
): Money {
  if (!Number.isFinite(value)) {
    throw new MoneyError(`Cannot convert non-finite value to money: ${value}`);
  }

  const factor = 10 ** minorUnitExponent(currency);
  // Scale first, then round once: rounding the product avoids compounding the
  // representation error of the incoming float.
  return money(roundNumber(value * factor, rounding), currency);
}

/** The major-unit value, for display and serialisation only. */
export function toMajor(value: Money): number {
  return value.amount / 10 ** minorUnitExponent(value.currency);
}

function roundNumber(value: number, mode: RoundingMode): number {
  switch (mode) {
    case 'ceil':
      return Math.ceil(value);
    case 'floor':
      return Math.floor(value);
    case 'trunc':
      return Math.trunc(value);
    case 'half-even': {
      const floor = Math.floor(value);
      const diff = value - floor;
      if (diff > 0.5) return floor + 1;
      if (diff < 0.5) return floor;
      return floor % 2 === 0 ? floor : floor + 1;
    }
    case 'half-up':
    default:
      // Math.round breaks ties toward +Infinity, which rounds -0.5 to -0, so
      // ties are resolved away from zero explicitly for symmetry.
      return value < 0 ? -Math.round(-value) : Math.round(value);
  }
}

function assertSameCurrency(a: Money, b: Money): void {
  if (a.currency !== b.currency) {
    throw new MoneyError(
      `Currency mismatch: cannot combine ${a.currency} with ${b.currency}. ` +
        'Convert explicitly with a dated exchange rate first.',
    );
  }
}

export function add(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return money(a.amount + b.amount, a.currency);
}

export function subtract(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return money(a.amount - b.amount, a.currency);
}

export function negate(value: Money): Money {
  return money(-value.amount, value.currency);
}

export function abs(value: Money): Money {
  return money(Math.abs(value.amount), value.currency);
}

/** Multiply by a whole count, e.g. nights or passengers. Exact, never rounds. */
export function multiply(value: Money, count: number): Money {
  if (!Number.isSafeInteger(count)) {
    throw new MoneyError(`multiply() takes an integer count; use scale() for fractions`);
  }
  return money(value.amount * count, value.currency);
}

/** Multiply by a fraction (tax, commission, percentage) with explicit rounding. */
export function scale(value: Money, factor: number, rounding: RoundingMode = 'half-up'): Money {
  if (!Number.isFinite(factor)) {
    throw new MoneyError(`Cannot scale money by non-finite factor: ${factor}`);
  }
  return money(roundNumber(value.amount * factor, rounding), value.currency);
}

/** Sum a list. An empty list needs an explicit currency to stay well-typed. */
export function sum(values: readonly Money[], currency?: CurrencyCode): Money {
  const first = values[0];

  if (first === undefined) {
    if (!currency) {
      throw new MoneyError('sum() of an empty list requires an explicit currency');
    }
    return zero(currency);
  }

  const target = (currency ?? first.currency).toUpperCase();
  let total = 0;

  for (const value of values) {
    if (value.currency !== target) {
      throw new MoneyError(`Currency mismatch in sum(): expected ${target}, got ${value.currency}`);
    }
    total += value.amount;
  }

  return money(total, target);
}

/**
 * Split an amount into `parts` shares that add back up to the original exactly.
 *
 * Used for per-person and per-night splits, where naive division would leak or
 * invent a minor unit. Remainder minor units are distributed to the leading
 * shares, so the sum of the result always equals the input.
 */
export function allocate(value: Money, parts: number): Money[] {
  if (!Number.isSafeInteger(parts) || parts <= 0) {
    throw new MoneyError(`allocate() requires a positive integer part count, received ${parts}`);
  }

  const sign = value.amount < 0 ? -1 : 1;
  const total = Math.abs(value.amount);
  const base = Math.floor(total / parts);
  let remainder = total - base * parts;

  const shares: Money[] = [];
  for (let index = 0; index < parts; index += 1) {
    const extra = remainder > 0 ? 1 : 0;
    remainder -= extra;
    shares.push(money(sign * (base + extra), value.currency));
  }

  return shares;
}

/** Ratio between two amounts of the same currency, as a plain number. */
export function ratio(a: Money, b: Money): number {
  assertSameCurrency(a, b);
  if (b.amount === 0) {
    throw new MoneyError('Cannot compute a ratio against a zero denominator');
  }
  return a.amount / b.amount;
}

export function compare(a: Money, b: Money): -1 | 0 | 1 {
  assertSameCurrency(a, b);
  if (a.amount < b.amount) return -1;
  if (a.amount > b.amount) return 1;
  return 0;
}

export function equals(a: Money, b: Money): boolean {
  return a.currency === b.currency && a.amount === b.amount;
}

export function isZero(value: Money): boolean {
  return value.amount === 0;
}

export function isNegative(value: Money): boolean {
  return value.amount < 0;
}

export function lessThan(a: Money, b: Money): boolean {
  return compare(a, b) === -1;
}

export function greaterThan(a: Money, b: Money): boolean {
  return compare(a, b) === 1;
}

export function lessThanOrEqual(a: Money, b: Money): boolean {
  return compare(a, b) <= 0;
}

export function min(a: Money, b: Money): Money {
  return lessThan(a, b) ? a : b;
}

export function max(a: Money, b: Money): Money {
  return greaterThan(a, b) ? a : b;
}

/**
 * Locale-aware display string.
 *
 * Formatting is presentation only. Never parse a formatted string back into
 * money - keep the `Money` value and format at the edge.
 */
export function format(value: Money, locale = 'en-GB'): string {
  const exponent = minorUnitExponent(value.currency);

  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: value.currency,
    minimumFractionDigits: exponent,
    maximumFractionDigits: exponent,
  }).format(toMajor(value));
}

/** Stable, lossless serialisation for storage and provider request logs. */
export function serialize(value: Money): string {
  return `${value.currency}:${value.amount}`;
}

export function deserialize(serialized: string): Money {
  const [currency, amount] = serialized.split(':');

  if (!currency || amount === undefined) {
    throw new MoneyError(`Malformed serialized money value: ${JSON.stringify(serialized)}`);
  }

  return money(Number.parseInt(amount, 10), currency);
}
