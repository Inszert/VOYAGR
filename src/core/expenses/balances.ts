import { money } from '@/core/money';
import { compareIds, ExpenseError, sharesOf } from './split';
import type { Balance, Expense, Member, Transfer } from './types';

/**
 * Who is owed what, and who should pay whom.
 *
 * Currencies are never mixed. An expense in euros and one in forints produce
 * two separate sets of balances, and settling up happens inside each. Putting
 * them in one currency is a conversion, and a conversion needs a rate the
 * caller supplies through `src/core/fx.ts` - see `convertExpenses`.
 */

export interface CurrencyBalances {
  readonly currency: string;
  /** One entry per member, in member id order, including members at zero. */
  readonly balances: readonly Balance[];
}

/**
 * Net position per member per currency: what they paid minus what they owe.
 *
 * Within a currency the balances sum to zero, because every expense adds its
 * amount to one member and subtracts the same amount, split, from others.
 */
export function balances(
  members: readonly Member[],
  expenses: readonly Expense[],
): CurrencyBalances[] {
  const ids = members.map((member) => member.id);
  if (new Set(ids).size !== ids.length) {
    throw new ExpenseError('Two members share an id');
  }
  const known = new Set(ids);
  const sortedIds = [...ids].sort(compareIds);

  const byCurrency = new Map<string, Map<string, number>>();
  const ledger = (currency: string): Map<string, number> => {
    let table = byCurrency.get(currency);
    if (!table) {
      table = new Map(sortedIds.map((id) => [id, 0]));
      byCurrency.set(currency, table);
    }
    return table;
  };

  for (const expense of expenses) {
    if (!known.has(expense.paidBy)) {
      throw new ExpenseError(`Expense ${expense.id} was paid by someone who is not a member`);
    }
    const shares = sharesOf(expense.amount, expense.split);
    for (const share of shares) {
      if (!known.has(share.memberId)) {
        throw new ExpenseError(`Expense ${expense.id} is shared with someone who is not a member`);
      }
    }

    const table = ledger(expense.amount.currency);
    table.set(expense.paidBy, (table.get(expense.paidBy) ?? 0) + expense.amount.amount);
    for (const share of shares) {
      table.set(share.memberId, (table.get(share.memberId) ?? 0) - share.amount.amount);
    }
  }

  return [...byCurrency.keys()].sort(compareIds).map((currency) => ({
    currency,
    balances: sortedIds.map((memberId) =>
      Object.freeze({
        memberId,
        amount: money(byCurrency.get(currency)?.get(memberId) ?? 0, currency),
      }),
    ),
  }));
}

/**
 * Transfers that bring every balance to zero.
 *
 * Greedy: the largest debtor pays the largest creditor as much as either can
 * settle, repeat. Ties go to the lower member id, so the same ledger always
 * gives the same list. It is not guaranteed to be the theoretical minimum
 * (that is NP-hard), but each transfer clears at least one person, so there
 * are always fewer transfers than people with a non-zero balance.
 */
export function settleUp(group: CurrencyBalances): Transfer[] {
  const net = group.balances.reduce((acc, entry) => acc + entry.amount.amount, 0);
  if (net !== 0) {
    throw new ExpenseError(`Balances in ${group.currency} do not sum to zero (${net})`);
  }

  type Open = { id: string; left: number };
  const creditors: Open[] = group.balances
    .filter((entry) => entry.amount.amount > 0)
    .map((entry) => ({ id: entry.memberId, left: entry.amount.amount }));
  const debtors: Open[] = group.balances
    .filter((entry) => entry.amount.amount < 0)
    .map((entry) => ({ id: entry.memberId, left: -entry.amount.amount }));

  const largestFirst = (a: Open, b: Open) => b.left - a.left || compareIds(a.id, b.id);

  const transfers: Transfer[] = [];
  for (;;) {
    creditors.sort(largestFirst);
    debtors.sort(largestFirst);
    const creditor = creditors[0];
    const debtor = debtors[0];
    if (!creditor || !debtor || creditor.left === 0 || debtor.left === 0) break;

    const pay = Math.min(creditor.left, debtor.left);
    transfers.push(
      Object.freeze({ from: debtor.id, to: creditor.id, amount: money(pay, group.currency) }),
    );
    creditor.left -= pay;
    debtor.left -= pay;
  }

  return transfers;
}

/** Apply transfers to a balance set: the payer's balance rises, the receiver's falls. */
export function applyTransfers(
  group: CurrencyBalances,
  transfers: readonly Transfer[],
): CurrencyBalances {
  const table = new Map(group.balances.map((entry) => [entry.memberId, entry.amount.amount]));
  for (const transfer of transfers) {
    if (transfer.amount.currency !== group.currency) {
      throw new ExpenseError('A transfer is in a different currency from the balances');
    }
    table.set(transfer.from, (table.get(transfer.from) ?? 0) + transfer.amount.amount);
    table.set(transfer.to, (table.get(transfer.to) ?? 0) - transfer.amount.amount);
  }
  return {
    currency: group.currency,
    balances: group.balances.map((entry) => ({
      memberId: entry.memberId,
      amount: money(table.get(entry.memberId) ?? 0, group.currency),
    })),
  };
}
