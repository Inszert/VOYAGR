import { minorUnitExponent } from '@/core/money';

/**
 * The currencies an expense can be recorded in.
 *
 * A list a traveller can choose from, instead of a three-letter box where a
 * typo is only discovered when the form is refused. Every code here is an
 * ISO 4217 currency that `src/core/money.ts` can hold and format, with the
 * right number of decimals - `currencies.test.ts` checks that, so a code cannot
 * be added that the arithmetic would reject. It is not every currency in the
 * world: the form never offers what the product has not been checked against.
 *
 * Sorted by code, with the names a person knows them by.
 */
export const EXPENSE_CURRENCIES: readonly { readonly code: string; readonly name: string }[] = [
  { code: 'AED', name: 'UAE dirham' },
  { code: 'AUD', name: 'Australian dollar' },
  { code: 'BGN', name: 'Bulgarian lev' },
  { code: 'BHD', name: 'Bahraini dinar' },
  { code: 'BRL', name: 'Brazilian real' },
  { code: 'CAD', name: 'Canadian dollar' },
  { code: 'CHF', name: 'Swiss franc' },
  { code: 'CLP', name: 'Chilean peso' },
  { code: 'CNY', name: 'Chinese yuan' },
  { code: 'CZK', name: 'Czech koruna' },
  { code: 'DKK', name: 'Danish krone' },
  { code: 'EGP', name: 'Egyptian pound' },
  { code: 'EUR', name: 'Euro' },
  { code: 'GBP', name: 'British pound' },
  { code: 'HKD', name: 'Hong Kong dollar' },
  { code: 'HUF', name: 'Hungarian forint' },
  { code: 'IDR', name: 'Indonesian rupiah' },
  { code: 'ILS', name: 'Israeli shekel' },
  { code: 'INR', name: 'Indian rupee' },
  { code: 'ISK', name: 'Icelandic krona' },
  { code: 'JOD', name: 'Jordanian dinar' },
  { code: 'JPY', name: 'Japanese yen' },
  { code: 'KRW', name: 'South Korean won' },
  { code: 'KWD', name: 'Kuwaiti dinar' },
  { code: 'MAD', name: 'Moroccan dirham' },
  { code: 'MXN', name: 'Mexican peso' },
  { code: 'MYR', name: 'Malaysian ringgit' },
  { code: 'NOK', name: 'Norwegian krone' },
  { code: 'NZD', name: 'New Zealand dollar' },
  { code: 'OMR', name: 'Omani rial' },
  { code: 'PHP', name: 'Philippine peso' },
  { code: 'PLN', name: 'Polish zloty' },
  { code: 'RON', name: 'Romanian leu' },
  { code: 'SAR', name: 'Saudi riyal' },
  { code: 'SEK', name: 'Swedish krona' },
  { code: 'SGD', name: 'Singapore dollar' },
  { code: 'THB', name: 'Thai baht' },
  { code: 'TND', name: 'Tunisian dinar' },
  { code: 'TRY', name: 'Turkish lira' },
  { code: 'USD', name: 'US dollar' },
  { code: 'VND', name: 'Vietnamese dong' },
  { code: 'ZAR', name: 'South African rand' },
];

/**
 * The options for a native select.
 *
 * `also` keeps a currency an existing expense already uses selectable when it
 * is not on the list, so editing it does not silently change it.
 */
export function expenseCurrencyOptions(
  also: readonly string[] = [],
): { value: string; label: string }[] {
  const listed = new Set(EXPENSE_CURRENCIES.map((entry) => entry.code));
  const extra = also
    .map((code) => code.toUpperCase())
    .filter((code, index, all) => !listed.has(code) && all.indexOf(code) === index)
    .map((code) => ({ value: code, label: `${code} (${minorUnitExponent(code)} decimals)` }));

  return [
    ...EXPENSE_CURRENCIES.map((entry) => ({
      value: entry.code,
      label: `${entry.code} – ${entry.name}`,
    })),
    ...extra,
  ];
}
