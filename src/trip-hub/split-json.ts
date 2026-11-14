import { z } from 'zod';
import { money } from '@/core/money';
import type { Split } from '@/core/expenses';

/**
 * A split as it is stored: JSON, with every amount an integer of minor units.
 *
 * The currency is not repeated inside it. An exact split is always in its
 * expense's own currency (the core rejects anything else), so it is read back
 * with that currency rather than trusting a second copy.
 */

const MemberId = z.string().min(1);
const MinorUnits = z.number().int().safe();

const StoredSplit = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('equal'), memberIds: z.array(MemberId) }),
  z.object({
    kind: z.literal('exact'),
    amounts: z.array(z.object({ memberId: MemberId, amount: MinorUnits })),
  }),
  z.object({
    kind: z.literal('shares'),
    weights: z.array(z.object({ memberId: MemberId, weight: MinorUnits })),
  }),
]);

export type StoredSplitJson = z.infer<typeof StoredSplit>;

export function splitToJson(split: Split): StoredSplitJson {
  switch (split.kind) {
    case 'equal':
      return { kind: 'equal', memberIds: [...split.memberIds] };
    case 'shares':
      return { kind: 'shares', weights: split.weights.map((w) => ({ ...w })) };
    case 'exact':
      return {
        kind: 'exact',
        amounts: split.amounts.map((a) => ({ memberId: a.memberId, amount: a.amount.amount })),
      };
  }
}

/** Throws a ZodError for a stored split that is not the shape we write. */
export function splitFromJson(value: unknown, currency: string): Split {
  const stored = StoredSplit.parse(value);
  if (stored.kind === 'exact') {
    return {
      kind: 'exact',
      amounts: stored.amounts.map((a) => ({
        memberId: a.memberId,
        amount: money(a.amount, currency),
      })),
    };
  }
  return stored;
}
