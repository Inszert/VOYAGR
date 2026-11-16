import { minorUnitExponent, money, type Money } from '@/core/money';

/**
 * A price as a scraped page prints it, read into exact minor units.
 *
 * `fromMajor` takes a float, which is right for a vendor's JSON number and wrong for text: a
 * string like `1,234` is either one thousand two hundred and thirty-four or one and a quarter,
 * and a float parse picks one without saying. Here the digits are never turned into a float. They
 * are split at the separators, padded to the currency's exponent and read as one integer, and
 * anything that cannot be read *exactly* is refused rather than rounded - a price we are unsure
 * of is better absent than plausible.
 *
 * The rules, in the order they bite:
 *  - Currency symbols and ISO codes may sit on either side. If the text names a currency and a
 *    hint is given, they must agree (`$` agrees with every dollar).
 *  - Spaces, including no-break and thin spaces, are digit-group separators.
 *  - Two separator kinds: the one that comes last is the decimal point.
 *  - One kind, repeated: thousands, in groups of three.
 *  - One kind, once, followed by exactly three digits: thousands - unless the currency has three
 *    minor digits, where it is genuinely ambiguous and is refused.
 *  - One kind, once, otherwise: a decimal point, with no more digits than the currency has.
 *  - Zero, negative and empty are not prices.
 */

const SYMBOL_CURRENCY: Readonly<Record<string, readonly string[]>> = {
  '€': ['EUR'],
  '£': ['GBP'],
  $: ['USD', 'CAD', 'AUD', 'NZD', 'SGD', 'HKD', 'MXN'],
  '¥': ['JPY', 'CNY'],
};

const GROUP_SPACES = /[\s   ]+/g;

/** `1 234`-style groups: digits, then groups of exactly three. */
const THOUSANDS_GROUPS = /^\d{1,3}(?:[.,]\d{3})+$/;

function readDigits(body: string, exponent: number): { whole: string; fraction: string } | null {
  const separators = [...body.matchAll(/[.,]/g)].map((match) => match[0]);

  if (separators.length === 0) return { whole: body, fraction: '' };

  const last = body.lastIndexOf(separators[separators.length - 1]!);
  const lastSeparator = body[last]!;
  const tail = body.slice(last + 1);
  const head = body.slice(0, last);

  const kinds = new Set(separators);

  if (kinds.size === 2) {
    // The later kind is the decimal point, so it appears once; before it, only thousands groups.
    if (head.includes(lastSeparator) || !THOUSANDS_GROUPS.test(head)) return null;
    if (tail.length < 1 || tail.length > exponent) return null;
    return { whole: head.replace(/[.,]/g, ''), fraction: tail };
  }

  if (separators.length > 1) {
    // One kind, repeated: it cannot be a decimal point.
    return THOUSANDS_GROUPS.test(body) ? { whole: body.replace(/[.,]/g, ''), fraction: '' } : null;
  }

  // One separator, once.
  if (head.length === 0 || tail.length === 0) return null;

  if (tail.length === 3 && head.length <= 3) {
    // Thousands, unless the currency itself has three decimals.
    return exponent === 3 ? null : { whole: head + tail, fraction: '' };
  }

  if (tail.length > exponent) return null;
  return { whole: head, fraction: tail };
}

/** The text as `Money`, or null when it cannot be read exactly. Never throws. */
export function parsePriceText(text: string, currencyHint?: string): Money | null {
  let rest = text.replace(GROUP_SPACES, ' ').trim();
  if (rest.length === 0) return null;

  let named: readonly string[] | null = null;

  for (const [symbol, currencies] of Object.entries(SYMBOL_CURRENCY)) {
    if (rest.includes(symbol)) {
      if (named) return null;
      named = currencies;
      rest = rest.replaceAll(symbol, ' ');
    }
  }

  const code = /\b[A-Za-z]{3}\b/.exec(rest);
  if (code) {
    if (named) return null;
    named = [code[0].toUpperCase()];
    rest = rest.replace(code[0], ' ');
  }

  const hint = currencyHint?.toUpperCase();
  if (hint && !/^[A-Z]{3}$/.test(hint)) return null;
  if (hint && named && !named.includes(hint)) return null;

  const resolved = hint ?? (named && named.length === 1 ? named[0] : undefined);
  // `$` alone names seven currencies and says which of none of them.
  if (!resolved) return null;

  // What is left must be a bare number, with spaces only as digit-group marks.
  const body = rest.trim().replace(/(?<=\d) (?=\d)/g, '');
  if (!/^\d[\d.,]*$/.test(body)) return null;

  const exponent = minorUnitExponent(resolved);
  const digits = readDigits(body, exponent);
  if (!digits || !/^\d+$/.test(digits.whole) || !/^\d*$/.test(digits.fraction)) return null;

  const amount = Number(digits.whole + digits.fraction.padEnd(exponent, '0'));
  if (!Number.isSafeInteger(amount) || amount <= 0) return null;

  return money(amount, resolved);
}
