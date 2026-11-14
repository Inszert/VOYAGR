import { convert, type ConversionFailure, type ConvertOptions, type RateSource } from '@/core/fx';
import type { CurrencyCode } from '@/core/money';
import { sharesOf } from './split';
import type { Expense } from './types';

/**
 * Putting a list of expenses into one currency, only where the caller has a rate.
 *
 * Nothing in this module chooses a rate. Expenses already in `target` pass
 * through untouched; any other currency needs `rates` to have the pair, and
 * a missing pair is reported by name rather than skipped, so a total is
 * never quietly short.
 *
 * The total of an expense is converted once, and the split follows it: equal
 * and weighted splits keep their meaning, and an exact split becomes weights
 * proportional to the amounts that were stated. Converting each exact amount
 * separately would round each one on its own and stop adding up to the total.
 */

export type ConvertedExpenses =
  | { readonly ok: true; readonly expenses: Expense[] }
  | { readonly ok: false; readonly failures: ConversionFailure[] };

export function convertExpenses(
  expenses: readonly Expense[],
  target: CurrencyCode,
  rates: RateSource,
  options: ConvertOptions = {},
): ConvertedExpenses {
  const to = target.toUpperCase();
  const failures: ConversionFailure[] = [];
  const converted: Expense[] = [];

  for (const expense of expenses) {
    if (expense.amount.currency === to) {
      converted.push(expense);
      continue;
    }

    const result = convert(expense.amount, to, rates, options);
    if (!result.ok) {
      const { failure } = result;
      const seen = failures.some((f) => f.from === failure.from && f.to === failure.to);
      if (!seen) failures.push(failure);
      continue;
    }

    const { split } = expense;
    converted.push({
      ...expense,
      amount: result.value,
      split:
        split.kind === 'exact'
          ? {
              kind: 'shares',
              weights: sharesOf(expense.amount, split).map((share) => ({
                memberId: share.memberId,
                weight: share.amount.amount,
              })),
            }
          : split,
    });
  }

  return failures.length > 0 ? { ok: false, failures } : { ok: true, expenses: converted };
}
