import { describe, expect, it } from 'vitest';
import { fixedRates } from '@/core/fx';
import { money, sum } from '@/core/money';
import {
  applyTransfers,
  balances,
  convertExpenses,
  ExpenseError,
  settleUp,
  sharesOf,
  validateExpense,
  type Expense,
  type Member,
  type Split,
} from './index';

const eur = (amount: number) => money(amount, 'EUR');

/** A small seeded generator, so the property tests are the same on every run. */
function lcg(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

const members: Member[] = [
  { id: 'a', name: 'Ada' },
  { id: 'b', name: 'Ben' },
  { id: 'c', name: 'Cleo' },
];

function expense(partial: Partial<Expense> & Pick<Expense, 'amount' | 'split'>): Expense {
  return { id: 'e1', paidBy: 'a', description: 'Dinner', date: '2026-07-01', ...partial };
}

describe('sharesOf: equal', () => {
  it('splits evenly when it divides', () => {
    const shares = sharesOf(eur(900), { kind: 'equal', memberIds: ['a', 'b', 'c'] });
    expect(shares.map((s) => s.amount.amount)).toEqual([300, 300, 300]);
  });

  it('gives the odd minor unit to the lower id on a tie', () => {
    const shares = sharesOf(eur(100), { kind: 'equal', memberIds: ['c', 'a', 'b'] });
    expect(shares.map((s) => [s.memberId, s.amount.amount])).toEqual([
      ['a', 34],
      ['b', 33],
      ['c', 33],
    ]);
  });

  it('gives two leftover units to the first two ids', () => {
    const shares = sharesOf(eur(101), { kind: 'equal', memberIds: ['a', 'b', 'c'] });
    expect(shares.map((s) => s.amount.amount)).toEqual([34, 34, 33]);
  });

  it('handles the smallest amount: one minor unit between three', () => {
    const shares = sharesOf(eur(1), { kind: 'equal', memberIds: ['a', 'b', 'c'] });
    expect(shares.map((s) => s.amount.amount)).toEqual([1, 0, 0]);
  });

  it('is the same whatever order the members are listed in', () => {
    const one = sharesOf(eur(1000), { kind: 'equal', memberIds: ['a', 'b', 'c'] });
    const two = sharesOf(eur(1000), { kind: 'equal', memberIds: ['c', 'b', 'a'] });
    expect(two).toEqual(one);
  });

  it('rejects an empty member list, a repeated member and a non-positive amount', () => {
    expect(() => sharesOf(eur(100), { kind: 'equal', memberIds: [] })).toThrow(ExpenseError);
    expect(() => sharesOf(eur(100), { kind: 'equal', memberIds: ['a', 'a'] })).toThrow(
      ExpenseError,
    );
    expect(() => sharesOf(eur(0), { kind: 'equal', memberIds: ['a'] })).toThrow(ExpenseError);
    expect(() => sharesOf(eur(-5), { kind: 'equal', memberIds: ['a'] })).toThrow(ExpenseError);
  });

  it('does not lose precision near the safe-integer limit', () => {
    const big = Number.MAX_SAFE_INTEGER;
    const shares = sharesOf(eur(big), { kind: 'equal', memberIds: ['a', 'b', 'c'] });
    expect(shares.reduce((acc, s) => acc + s.amount.amount, 0)).toBe(big);
  });
});

describe('sharesOf: shares', () => {
  it('divides in proportion to the weights', () => {
    const shares = sharesOf(eur(1000), {
      kind: 'shares',
      weights: [
        { memberId: 'a', weight: 2 },
        { memberId: 'b', weight: 2 },
        { memberId: 'c', weight: 1 },
      ],
    });
    expect(shares.map((s) => s.amount.amount)).toEqual([400, 400, 200]);
  });

  it('gives remainders to the largest fraction, then the lower id', () => {
    // 10 over weights 1:1:1 -> 3.33 each, one spare unit, a tie, so 'a'.
    // 10 over weights 1:2 -> 3.33 and 6.67, the spare unit goes to 'b'.
    const split: Split = {
      kind: 'shares',
      weights: [
        { memberId: 'a', weight: 1 },
        { memberId: 'b', weight: 2 },
      ],
    };
    expect(sharesOf(eur(10), split).map((s) => s.amount.amount)).toEqual([3, 7]);
  });

  it('never charges a member whose weight is zero', () => {
    const shares = sharesOf(eur(5), {
      kind: 'shares',
      weights: [
        { memberId: 'a', weight: 0 },
        { memberId: 'b', weight: 3 },
      ],
    });
    expect(shares.map((s) => s.amount.amount)).toEqual([0, 5]);
  });

  it('rejects all-zero, negative, fractional and repeated weights', () => {
    const one = (weight: number) => ({
      kind: 'shares' as const,
      weights: [{ memberId: 'a', weight }],
    });
    expect(() => sharesOf(eur(5), one(0))).toThrow(ExpenseError);
    expect(() => sharesOf(eur(5), one(-1))).toThrow(ExpenseError);
    expect(() => sharesOf(eur(5), one(1.5))).toThrow(ExpenseError);
    expect(() =>
      sharesOf(eur(5), {
        kind: 'shares',
        weights: [
          { memberId: 'a', weight: 1 },
          { memberId: 'a', weight: 1 },
        ],
      }),
    ).toThrow(ExpenseError);
  });
});

describe('sharesOf: exact', () => {
  const exact = (...amounts: [string, number][]): Split => ({
    kind: 'exact',
    amounts: amounts.map(([memberId, amount]) => ({ memberId, amount: eur(amount) })),
  });

  it('accepts amounts that sum to the total', () => {
    const shares = sharesOf(eur(1000), exact(['a', 250], ['b', 750]));
    expect(shares.map((s) => s.amount.amount)).toEqual([250, 750]);
  });

  it('rejects one minor unit under and one over, but not the exact total', () => {
    expect(() => sharesOf(eur(1000), exact(['a', 250], ['b', 749]))).toThrow(ExpenseError);
    expect(() => sharesOf(eur(1000), exact(['a', 250], ['b', 751]))).toThrow(ExpenseError);
    expect(() => sharesOf(eur(1000), exact(['a', 250], ['b', 750]))).not.toThrow();
  });

  it('rejects a negative amount even when the total still adds up', () => {
    expect(() => sharesOf(eur(1000), exact(['a', 1200], ['b', -200]))).toThrow(ExpenseError);
  });

  it('rejects an amount in another currency', () => {
    expect(() =>
      sharesOf(eur(100), {
        kind: 'exact',
        amounts: [{ memberId: 'a', amount: money(100, 'USD') }],
      }),
    ).toThrow(ExpenseError);
  });

  it('rejects an empty exact split, which cannot add up to a positive total', () => {
    expect(() => sharesOf(eur(100), { kind: 'exact', amounts: [] })).toThrow(ExpenseError);
  });
});

describe('validateExpense', () => {
  it('rejects a date that is not a calendar date', () => {
    const bad = expense({
      amount: eur(100),
      split: { kind: 'equal', memberIds: ['a'] },
      date: '2026-02-30',
    });
    expect(() => validateExpense(bad)).toThrow(ExpenseError);
  });
});

describe('balances', () => {
  it('credits the payer and debits each sharer', () => {
    const result = balances(members, [
      expense({ amount: eur(900), split: { kind: 'equal', memberIds: ['a', 'b', 'c'] } }),
    ]);
    expect(result).toHaveLength(1);
    expect(result[0]?.balances.map((b) => [b.memberId, b.amount.amount])).toEqual([
      ['a', 600],
      ['b', -300],
      ['c', -300],
    ]);
  });

  it('lists every member, at zero, when nothing has been spent in a currency by them', () => {
    const result = balances(members, [
      expense({ amount: eur(100), split: { kind: 'equal', memberIds: ['a'] } }),
    ]);
    expect(result[0]?.balances).toHaveLength(3);
  });

  it('returns nothing for no expenses', () => {
    expect(balances(members, [])).toEqual([]);
  });

  it('keeps currencies apart', () => {
    const result = balances(members, [
      expense({ id: '1', amount: eur(100), split: { kind: 'equal', memberIds: ['a', 'b'] } }),
      expense({
        id: '2',
        paidBy: 'b',
        amount: money(5000, 'HUF'),
        split: { kind: 'equal', memberIds: ['a', 'b'] },
      }),
    ]);
    expect(result.map((r) => r.currency)).toEqual(['EUR', 'HUF']);
    expect(result[0]?.balances.map((b) => b.amount.amount)).toEqual([50, -50, 0]);
    expect(result[1]?.balances.map((b) => b.amount.amount)).toEqual([-2500, 2500, 0]);
  });

  it('rejects a payer or sharer who is not a member, and duplicate member ids', () => {
    expect(() =>
      balances(members, [
        expense({ paidBy: 'z', amount: eur(100), split: { kind: 'equal', memberIds: ['a'] } }),
      ]),
    ).toThrow(ExpenseError);
    expect(() =>
      balances(members, [
        expense({ amount: eur(100), split: { kind: 'equal', memberIds: ['a', 'z'] } }),
      ]),
    ).toThrow(ExpenseError);
    expect(() => balances([members[0]!, members[0]!], [])).toThrow(ExpenseError);
  });

  it('is unaffected by the order of the members or expenses', () => {
    const list = [
      expense({ id: '1', amount: eur(101), split: { kind: 'equal', memberIds: ['a', 'b', 'c'] } }),
      expense({
        id: '2',
        paidBy: 'c',
        amount: eur(77),
        split: { kind: 'equal', memberIds: ['a', 'b'] },
      }),
    ];
    expect(balances([...members].reverse(), [...list].reverse())).toEqual(balances(members, list));
  });
});

describe('settleUp', () => {
  it('has the largest debtor pay the largest creditor', () => {
    const [group] = balances(members, [
      expense({ amount: eur(900), split: { kind: 'equal', memberIds: ['a', 'b', 'c'] } }),
    ]);
    const transfers = settleUp(group!);
    expect(transfers.map((t) => [t.from, t.to, t.amount.amount])).toEqual([
      ['b', 'a', 300],
      ['c', 'a', 300],
    ]);
  });

  it('is empty when everyone is square', () => {
    const [group] = balances(members, [
      expense({ amount: eur(100), split: { kind: 'equal', memberIds: ['a'] } }),
    ]);
    expect(settleUp(group!)).toEqual([]);
  });

  it('breaks ties by member id', () => {
    const transfers = settleUp({
      currency: 'EUR',
      balances: [
        { memberId: 'a', amount: eur(-50) },
        { memberId: 'b', amount: eur(-50) },
        { memberId: 'c', amount: eur(50) },
        { memberId: 'd', amount: eur(50) },
      ],
    });
    expect(transfers.map((t) => `${t.from}>${t.to}:${t.amount.amount}`)).toEqual([
      'a>c:50',
      'b>d:50',
    ]);
  });

  it('refuses balances that do not sum to zero', () => {
    expect(() =>
      settleUp({
        currency: 'EUR',
        balances: [{ memberId: 'a', amount: eur(1) }],
      }),
    ).toThrow(ExpenseError);
  });
});

describe('properties over generated ledgers', () => {
  const people: Member[] = ['a', 'b', 'c', 'd', 'e'].map((id) => ({ id, name: id }));

  function randomExpense(next: () => number, index: number): Expense {
    const amount = money(1 + Math.floor(next() * 100_000), next() < 0.7 ? 'EUR' : 'JPY');
    const pick = () => people.filter(() => next() < 0.6).map((p) => p.id);
    const chosen = pick();
    const memberIds = chosen.length > 0 ? chosen : ['a'];
    const kind = next();
    const split: Split =
      kind < 0.4
        ? { kind: 'equal', memberIds }
        : kind < 0.8
          ? {
              kind: 'shares',
              weights: memberIds.map((memberId) => ({
                memberId,
                weight: 1 + Math.floor(next() * 5),
              })),
            }
          : {
              kind: 'exact',
              amounts: sharesOf(amount, { kind: 'equal', memberIds }).map((s) => ({
                memberId: s.memberId,
                amount: s.amount,
              })),
            };
    return {
      id: `e${index}`,
      paidBy: people[Math.floor(next() * people.length)]!.id,
      amount,
      description: 'x',
      date: '2026-07-01',
      split,
    };
  }

  it('shares always sum to the expense', () => {
    const next = lcg(7);
    for (let i = 0; i < 300; i += 1) {
      const e = randomExpense(next, i);
      const shares = sharesOf(e.amount, e.split);
      expect(
        sum(
          shares.map((s) => s.amount),
          e.amount.currency,
        ),
      ).toEqual(e.amount);
      expect(shares.every((s) => s.amount.amount >= 0)).toBe(true);
    }
  });

  it('balances sum to zero per currency and settling up zeroes them', () => {
    const next = lcg(42);
    for (let round = 0; round < 60; round += 1) {
      const list = Array.from({ length: 1 + Math.floor(next() * 12) }, (_, i) =>
        randomExpense(next, i),
      );
      for (const group of balances(people, list)) {
        expect(group.balances.reduce((acc, b) => acc + b.amount.amount, 0)).toBe(0);

        const transfers = settleUp(group);
        const settled = applyTransfers(group, transfers);
        expect(settled.balances.every((b) => b.amount.amount === 0)).toBe(true);
        expect(transfers.every((t) => t.amount.amount > 0 && t.from !== t.to)).toBe(true);

        const open = group.balances.filter((b) => b.amount.amount !== 0).length;
        expect(transfers.length).toBeLessThanOrEqual(Math.max(0, open - 1));
      }
    }
  });

  it('gives the same answer twice', () => {
    const list = Array.from({ length: 8 }, (_, i) => randomExpense(lcg(i + 1), i));
    expect(balances(people, list)).toEqual(balances(people, list));
  });
});

describe('convertExpenses', () => {
  const rates = fixedRates([
    { from: 'USD', to: 'EUR', rate: 0.5, observedAt: '2026-07-01T00:00:00Z' },
  ]);

  it('leaves expenses already in the target currency alone', () => {
    const list = [expense({ amount: eur(100), split: { kind: 'equal', memberIds: ['a'] } })];
    expect(convertExpenses(list, 'EUR', rates)).toEqual({ ok: true, expenses: list });
  });

  it('converts through the supplied rate and keeps the split summing exactly', () => {
    const usd = expense({
      amount: money(1001, 'USD'),
      split: {
        kind: 'exact',
        amounts: [
          { memberId: 'a', amount: money(500, 'USD') },
          { memberId: 'b', amount: money(501, 'USD') },
        ],
      },
    });
    const result = convertExpenses([usd], 'EUR', rates);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const converted = result.expenses[0]!;
    expect(converted.amount.currency).toBe('EUR');
    const shares = sharesOf(converted.amount, converted.split);
    expect(shares.reduce((acc, s) => acc + s.amount.amount, 0)).toBe(converted.amount.amount);
  });

  it('names the missing pair instead of guessing, and does not use the reciprocal', () => {
    const eurExpense = expense({ amount: eur(100), split: { kind: 'equal', memberIds: ['a'] } });
    const result = convertExpenses([eurExpense], 'USD', rates);
    expect(result).toEqual({
      ok: false,
      failures: [{ reason: 'no_rate', from: 'EUR', to: 'USD' }],
    });
  });
});
