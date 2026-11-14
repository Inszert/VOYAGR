import type { IsoDate } from '@/core/trip/types';
import type { Money } from '@/core/money';

/**
 * Shared expenses, the way Tricount keeps them: a group of people, a list of
 * things somebody paid for, and how each one is shared out.
 *
 * Every amount is `Money` in integer minor units. A share is never a float.
 */

export interface Member {
  readonly id: string;
  readonly name: string;
}

/**
 * How one expense is shared.
 *
 * - `equal`: the chosen members pay the same, give or take a minor unit.
 * - `exact`: the amounts are stated and must add up to the expense.
 * - `shares`: the amount is divided in proportion to whole-number weights
 *   (two adults and a child as 2/2/1, a room for two nights against one).
 *
 * Weights are integers on purpose: a ratio like 0.3333 is a float in a place
 * where the sum has to come out exact.
 */
export type Split =
  | { readonly kind: 'equal'; readonly memberIds: readonly string[] }
  | {
      readonly kind: 'exact';
      readonly amounts: readonly { readonly memberId: string; readonly amount: Money }[];
    }
  | {
      readonly kind: 'shares';
      readonly weights: readonly { readonly memberId: string; readonly weight: number }[];
    };

export interface Expense {
  readonly id: string;
  readonly paidBy: string;
  readonly amount: Money;
  readonly description: string;
  readonly date: IsoDate;
  readonly split: Split;
}

/** What one member owes towards one expense. */
export interface Share {
  readonly memberId: string;
  readonly amount: Money;
}

/** Positive: the group owes this member. Negative: this member owes the group. */
export interface Balance {
  readonly memberId: string;
  readonly amount: Money;
}

export interface Transfer {
  readonly from: string;
  readonly to: string;
  readonly amount: Money;
}
