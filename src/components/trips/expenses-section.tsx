import { Button, Card, Field, Select } from '@/components/ui';
import {
  addExpenseAction,
  addMemberAction,
  removeExpenseAction,
  removeMemberAction,
} from '@/app/actions/trips';
import { ActionForm } from '@/components/trips/action-form';
import { format } from '@/core/money';
import type { TripMemberRecord } from '@/db/repository';
import { shortDate } from '@/lib/display-date';
import type { Ledger } from '@/trip-hub/service';

/**
 * The Expenses section.
 *
 * Every figure on it - each share, balance and transfer - comes from
 * `src/core/expenses` through `TripHubService.ledger`. This file only lays them
 * out. Currencies are shown separately and never added together: converting is
 * a decision that needs a rate we do not have.
 */

export function ExpensesSection({
  tripId,
  ledger,
  members,
  isOwner,
  selfId,
  defaultCurrency,
}: {
  readonly tripId: string;
  readonly ledger: Ledger;
  readonly members: readonly TripMemberRecord[];
  readonly isOwner: boolean;
  /** The viewer's own seat; the owner cannot remove it. */
  readonly selfId: string;
  readonly defaultCurrency: string;
}) {
  const nameOf = (id: string) => members.find((member) => member.id === id)?.name ?? 'Unknown';
  const today = new Date().toISOString().slice(0, 10);

  return (
    <section aria-labelledby="expenses-heading" className="flex flex-col gap-5">
      <h2 id="expenses-heading" className="font-display text-display-sm text-ink">
        Expenses
      </h2>

      <div>
        <h3 className="text-ink mb-2 text-base font-medium">People</h3>
        <ul className="flex flex-col gap-2">
          {members.map((member) => (
            <li key={member.id} className="flex flex-wrap items-center gap-3">
              <span className="text-ink">{member.name}</span>
              {isOwner && member.id !== selfId ? (
                <form action={removeMemberAction}>
                  <input type="hidden" name="tripId" value={tripId} />
                  <input type="hidden" name="memberId" value={member.id} />
                  <Button type="submit" variant="ghost" size="md">
                    Remove<span className="sr-only"> {member.name}</span>
                  </Button>
                </form>
              ) : null}
            </li>
          ))}
        </ul>
        {isOwner ? (
          <Card className="mt-4">
            <h4 className="text-ink mb-3 text-sm font-medium">Add a person</h4>
            <ActionForm
              action={addMemberAction}
              submitLabel="Add person"
              savedMessage="Added."
              hidden={{ tripId }}
            >
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Name" name="name" required maxLength={80} autoComplete="off" />
                <Field
                  label="Their Voyagr email"
                  name="accountEmail"
                  type="email"
                  hint="Optional. If they have an account they can open this trip."
                  autoComplete="off"
                />
              </div>
            </ActionForm>
          </Card>
        ) : null}
      </div>

      <div>
        <h3 className="text-ink mb-2 text-base font-medium">Balances</h3>
        {ledger.balances.length === 0 ? (
          <p className="text-ink-muted">No expenses yet.</p>
        ) : (
          ledger.balances.map((group) => (
            <table key={group.currency} className="mb-4 w-full max-w-xl text-left text-sm">
              <caption className="text-ink-muted pb-2 text-left">
                Balances in {group.currency}
              </caption>
              <thead>
                <tr>
                  <th scope="col" className="text-ink py-1 pr-4 font-medium">
                    Person
                  </th>
                  <th scope="col" className="text-ink py-1 pr-4 text-right font-medium">
                    Balance
                  </th>
                  <th scope="col" className="text-ink py-1 font-medium">
                    Position
                  </th>
                </tr>
              </thead>
              <tbody>
                {group.balances.map((entry) => (
                  <tr key={entry.memberId} className="border-border border-t">
                    <th scope="row" className="text-ink py-2 pr-4 font-normal">
                      {nameOf(entry.memberId)}
                    </th>
                    <td className="py-2 pr-4 text-right tabular-nums">{format(entry.amount)}</td>
                    <td className="text-ink-muted py-2">
                      {entry.amount.amount > 0
                        ? 'is owed'
                        : entry.amount.amount < 0
                          ? 'owes'
                          : 'settled'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ))
        )}
      </div>

      {ledger.balances.length > 0 ? (
        <div>
          <h3 className="text-ink mb-2 text-base font-medium">Settle up</h3>
          {ledger.settlements.every((group) => group.transfers.length === 0) ? (
            <p className="text-ink-muted">Everyone is square.</p>
          ) : (
            ledger.settlements.map((group) =>
              group.transfers.length === 0 ? null : (
                <ul
                  key={group.currency}
                  aria-label={`Payments in ${group.currency}`}
                  className="mb-3"
                >
                  {group.transfers.map((transfer) => (
                    <li key={`${transfer.from}-${transfer.to}`} className="text-ink py-1">
                      {nameOf(transfer.from)} pays {nameOf(transfer.to)}{' '}
                      <span className="tabular-nums">{format(transfer.amount)}</span>
                    </li>
                  ))}
                </ul>
              ),
            )
          )}
        </div>
      ) : null}

      <div>
        <h3 className="text-ink mb-2 text-base font-medium">All expenses</h3>
        {ledger.expenses.length === 0 ? (
          <p className="text-ink-muted">Nothing recorded.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {ledger.expenses.map((expense) => (
              <li key={expense.id} className="flex flex-wrap items-center gap-3">
                <span className="text-ink">
                  {shortDate(expense.date)} · {expense.description} ·{' '}
                  <span className="tabular-nums">{format(expense.amount)}</span> paid by{' '}
                  {nameOf(expense.paidBy)}
                </span>
                <form action={removeExpenseAction}>
                  <input type="hidden" name="tripId" value={tripId} />
                  <input type="hidden" name="expenseId" value={expense.id} />
                  <Button type="submit" variant="ghost" size="md">
                    Remove<span className="sr-only"> {expense.description}</span>
                  </Button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </div>

      <Card as="section" aria-labelledby="add-expense-heading">
        <h3 id="add-expense-heading" className="text-ink mb-4 text-lg font-medium">
          Add an expense
        </h3>
        <ActionForm
          action={addExpenseAction}
          submitLabel="Add expense"
          savedMessage="Expense added."
          hidden={{ tripId }}
        >
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Field
              label="What for"
              name="description"
              required
              maxLength={140}
              autoComplete="off"
            />
            <Field label="Amount" name="amount" required inputMode="decimal" autoComplete="off" />
            <Field
              label="Currency"
              name="currency"
              required
              maxLength={3}
              defaultValue={defaultCurrency}
              autoComplete="off"
            />
            <Field label="Date" name="date" type="date" required defaultValue={today} />
            <Select
              label="Paid by"
              name="paidBy"
              options={members.map((member) => ({ value: member.id, label: member.name }))}
            />
            <Select
              label="Split"
              name="splitKind"
              hint="Equally uses the ticked boxes; shares uses the share numbers; exact uses the amounts."
              options={[
                { value: 'equal', label: 'Equally between the ticked people' },
                { value: 'shares', label: 'By shares' },
                { value: 'exact', label: 'By exact amounts' },
              ]}
            />
          </div>

          <fieldset className="border-border rounded-(--radius-control) border p-4">
            <legend className="text-ink px-1 text-sm font-medium">Who shares it</legend>
            <ul className="flex flex-col gap-4">
              {members.map((member) => (
                <li key={member.id} className="grid items-end gap-3 sm:grid-cols-3">
                  <label className="text-ink flex items-center gap-2 text-sm">
                    <input type="checkbox" name={`include:${member.id}`} defaultChecked />
                    {member.name}
                    <span className="sr-only"> shares equally</span>
                  </label>
                  <Field
                    label={`Shares for ${member.name}`}
                    name={`weight:${member.id}`}
                    inputMode="numeric"
                    placeholder="1"
                    autoComplete="off"
                  />
                  <Field
                    label={`Exact amount for ${member.name}`}
                    name={`exact:${member.id}`}
                    inputMode="decimal"
                    autoComplete="off"
                  />
                </li>
              ))}
            </ul>
          </fieldset>
        </ActionForm>
      </Card>
    </section>
  );
}
