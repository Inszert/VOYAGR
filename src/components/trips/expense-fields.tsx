import { Field, Select } from '@/components/ui';
import type { TripExpenseRecord, TripMemberRecord } from '@/db/repository';
import { expenseCurrencyOptions } from '@/trip-hub/currencies';
import { majorText } from '@/components/trips/plan-item-fields';
import { minorUnitExponent } from '@/core/money';

/**
 * The fields of an expense, shared by "add" and "edit".
 *
 * With `expense` they start as its values: who paid, the amount as the digits
 * that were stored, its currency, and how it is split - the ticked people, the
 * share numbers or the exact amounts, whichever the expense used. Without, as a
 * blank equal split among everyone.
 *
 * The currency is a choice from the list `src/trip-hub/currencies.ts` checks
 * against `src/core/money.ts`, not three typed letters.
 */

export function ExpenseFields({
  members,
  expense,
  defaultCurrency,
  today,
}: {
  readonly members: readonly TripMemberRecord[];
  readonly expense?: TripExpenseRecord;
  readonly defaultCurrency: string;
  readonly today: string;
}) {
  const currency = expense?.amount.currency ?? defaultCurrency;
  const split = expense?.split;

  const included = (memberId: string): boolean =>
    !split ||
    (split.kind === 'equal'
      ? split.memberIds.includes(memberId)
      : split.kind === 'shares'
        ? split.weights.some((entry) => entry.memberId === memberId)
        : split.amounts.some((entry) => entry.memberId === memberId));

  const weightOf = (memberId: string): string =>
    split?.kind === 'shares'
      ? String(split.weights.find((entry) => entry.memberId === memberId)?.weight ?? '')
      : '';

  const exactOf = (memberId: string): string => {
    if (split?.kind !== 'exact') return '';
    const found = split.amounts.find((entry) => entry.memberId === memberId);
    return found ? majorText(found.amount.amount, minorUnitExponent(found.amount.currency)) : '';
  };

  return (
    <>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field
          label="What for"
          name="description"
          required
          maxLength={140}
          autoComplete="off"
          defaultValue={expense?.description}
        />
        <Field
          label="Amount"
          name="amount"
          required
          inputMode="decimal"
          autoComplete="off"
          defaultValue={
            expense ? majorText(expense.amount.amount, minorUnitExponent(currency)) : undefined
          }
        />
        <Select
          label="Currency"
          name="currency"
          required
          defaultValue={currency}
          options={expenseCurrencyOptions([currency])}
        />
        <Field
          label="Date"
          name="date"
          type="date"
          required
          defaultValue={expense?.date ?? today}
        />
        <Select
          label="Paid by"
          name="paidBy"
          defaultValue={expense?.paidBy}
          options={members.map((member) => ({ value: member.id, label: member.name }))}
        />
        <Select
          label="Split"
          name="splitKind"
          defaultValue={split?.kind ?? 'equal'}
          hint="Equally uses the ticked boxes; shares uses the share numbers; exact uses the amounts."
          options={[
            { value: 'equal', label: 'Equally between the ticked people' },
            { value: 'shares', label: 'By shares' },
            { value: 'exact', label: 'By exact amounts' },
          ]}
        />
      </div>

      <fieldset className="border-border rounded-(--radius-card) border p-4">
        <legend className="text-ink px-1 text-sm font-medium">Who shares it</legend>
        <ul className="flex flex-col gap-3">
          {members.map((member) => (
            <li key={member.id} className="grid items-end gap-3 sm:grid-cols-3">
              <label className="text-ink flex min-h-11 items-center gap-3 text-sm">
                <input
                  type="checkbox"
                  name={`include:${member.id}`}
                  defaultChecked={included(member.id)}
                  className="accent-brand-500 size-5 shrink-0"
                />
                {member.name}
                <span className="sr-only"> shares equally</span>
              </label>
              <Field
                label={`Shares for ${member.name}`}
                name={`weight:${member.id}`}
                inputMode="numeric"
                placeholder="1"
                autoComplete="off"
                defaultValue={weightOf(member.id)}
              />
              <Field
                label={`Exact amount for ${member.name}`}
                name={`exact:${member.id}`}
                inputMode="decimal"
                autoComplete="off"
                defaultValue={exactOf(member.id)}
              />
            </li>
          ))}
        </ul>
      </fieldset>
    </>
  );
}
