import { money, type Money } from '@/core/money';
import { isIsoDate } from '@/core/dates';
import type { Expense, Share, Split } from './types';

/**
 * Turning one expense into one share per member.
 *
 * The invariant everything else leans on: the shares of an expense add up to
 * its amount, exactly, in every case. A share that rounded down and lost a
 * minor unit would put a ghost balance on every trip that used it.
 */

export class ExpenseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExpenseError';
  }
}

/** Plain code-unit ordering, not locale ordering, so the same ids sort the same everywhere. */
export function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Divide `total` minor units in proportion to `weights`, by largest remainder.
 *
 * Each member takes the whole part of their proportion; the minor units left
 * over go one each to the largest fractional remainders, a tie going to the
 * lower member id. BigInt because `total x weight` can leave the safe-integer
 * range long before either of them does.
 */
function largestRemainder(
  total: number,
  currency: string,
  entries: readonly { readonly memberId: string; readonly weight: number }[],
): Share[] {
  const ordered = [...entries].sort((a, b) => compareIds(a.memberId, b.memberId));
  const weightSum = ordered.reduce((acc, entry) => acc + BigInt(entry.weight), 0n);

  if (weightSum <= 0n) {
    throw new ExpenseError('A split needs at least one member with a weight above zero');
  }

  const bigTotal = BigInt(total);
  const rows = ordered.map((entry) => {
    const product = bigTotal * BigInt(entry.weight);
    return {
      memberId: entry.memberId,
      whole: product / weightSum,
      remainder: product % weightSum,
    };
  });

  let leftover = Number(bigTotal - rows.reduce((acc, row) => acc + row.whole, 0n));

  const byRemainder = [...rows].sort((a, b) =>
    a.remainder === b.remainder
      ? compareIds(a.memberId, b.memberId)
      : a.remainder > b.remainder
        ? -1
        : 1,
  );
  const extra = new Set<string>();
  for (const row of byRemainder) {
    if (leftover <= 0) break;
    // A zero-weight member has remainder 0 and must never be charged.
    if (row.remainder === 0n) continue;
    extra.add(row.memberId);
    leftover -= 1;
  }

  return rows.map((row) =>
    Object.freeze({
      memberId: row.memberId,
      amount: money(Number(row.whole) + (extra.has(row.memberId) ? 1 : 0), currency),
    }),
  );
}

function assertNoDuplicates(ids: readonly string[]): void {
  if (new Set(ids).size !== ids.length) {
    throw new ExpenseError('A member appears twice in the same split');
  }
}

/** One share per member named in the split, summing exactly to `amount`. */
export function sharesOf(amount: Money, split: Split): Share[] {
  if (amount.amount <= 0) {
    throw new ExpenseError('An expense must be for more than zero');
  }

  switch (split.kind) {
    case 'equal': {
      if (split.memberIds.length === 0) {
        throw new ExpenseError('An equal split needs at least one member');
      }
      assertNoDuplicates(split.memberIds);
      return largestRemainder(
        amount.amount,
        amount.currency,
        split.memberIds.map((memberId) => ({ memberId, weight: 1 })),
      );
    }

    case 'shares': {
      assertNoDuplicates(split.weights.map((entry) => entry.memberId));
      for (const { weight } of split.weights) {
        if (!Number.isSafeInteger(weight) || weight < 0) {
          throw new ExpenseError(`A share weight must be a whole number of at least 0: ${weight}`);
        }
      }
      return largestRemainder(amount.amount, amount.currency, split.weights);
    }

    case 'exact': {
      assertNoDuplicates(split.amounts.map((entry) => entry.memberId));
      let total = 0;
      for (const entry of split.amounts) {
        if (entry.amount.currency !== amount.currency) {
          throw new ExpenseError(
            `An exact amount is in ${entry.amount.currency} but the expense is in ${amount.currency}`,
          );
        }
        if (entry.amount.amount < 0) {
          throw new ExpenseError('An exact amount cannot be negative');
        }
        total += entry.amount.amount;
      }
      if (total !== amount.amount) {
        throw new ExpenseError(
          `Exact amounts add up to ${total} but the expense is ${amount.amount} (minor units)`,
        );
      }
      return [...split.amounts]
        .sort((a, b) => compareIds(a.memberId, b.memberId))
        .map((entry) => Object.freeze({ memberId: entry.memberId, amount: entry.amount }));
    }
  }
}

/** Throws `ExpenseError` for an expense that could not be shared out. */
export function validateExpense(expense: Expense): void {
  if (!isIsoDate(expense.date)) {
    throw new ExpenseError(`An expense date must be a YYYY-MM-DD calendar date: ${expense.date}`);
  }
  sharesOf(expense.amount, expense.split);
}
