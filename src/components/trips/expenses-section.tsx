import { Button, Disclosure, Icon } from '@/components/ui';
import {
  addExpenseAction,
  addMemberAction,
  removeExpenseAction,
  removeMemberAction,
  updateExpenseAction,
} from '@/app/actions/trips';
import { ActionForm } from '@/components/trips/action-form';
import { ExpenseFields } from '@/components/trips/expense-fields';
import { MemberAvatars } from '@/components/trips/member-avatars';
import { SettleChecklist } from '@/components/trips/settle-checklist';
import { Field } from '@/components/ui';
import { format } from '@/core/money';
import type { TripMemberRecord } from '@/db/repository';
import { shortDate } from '@/lib/display-date';
import type { Ledger } from '@/trip-hub/service';

/**
 * The Money tab: who owes whom, how to settle, and every expense.
 *
 * Every figure on it - each share, balance and transfer - comes from
 * `src/core/expenses` through `TripHubService.ledger`. This file only lays them
 * out: it receives a `Money`, passes it to `format`, and adds nothing up.
 * Currencies are shown separately and never added together: converting is
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
  const everyoneSquare = ledger.settlements.every((group) => group.transfers.length === 0);

  return (
    <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_24rem] lg:gap-14">
      <div className="flex min-w-0 flex-col gap-12">
        <section aria-labelledby="balances-heading" className="flex flex-col gap-5">
          <h2 id="balances-heading" className="font-display text-display-sm text-ink">
            Who owes whom
          </h2>

          {ledger.balances.length === 0 ? (
            <p className="border-border-strong text-ink-muted rounded-(--radius-card) border border-dashed px-6 py-8 text-sm">
              No expenses yet. Add the first one and the balances appear here.
            </p>
          ) : (
            ledger.balances.map((group) => (
              <div
                key={group.currency}
                className="border-border overflow-x-auto rounded-(--radius-card) border"
              >
                <table className="w-full text-sm">
                  <caption className="text-ink-muted border-border border-b px-4 py-3 text-left text-xs font-medium tracking-[0.12em] uppercase">
                    Balances in {group.currency}
                  </caption>
                  <thead className="text-ink-muted bg-surface-sunken text-left">
                    <tr>
                      <th scope="col" className="px-4 py-2.5 font-medium">
                        Person
                      </th>
                      <th scope="col" className="px-4 py-2.5 font-medium">
                        Position
                      </th>
                      <th scope="col" className="px-4 py-2.5 text-right font-medium">
                        Balance
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-border divide-y">
                    {group.balances.map((entry) => (
                      <tr key={entry.memberId}>
                        <th scope="row" className="text-ink px-4 py-3 text-left font-medium">
                          {nameOf(entry.memberId)}
                        </th>
                        <td className="px-4 py-3">
                          {entry.amount.amount > 0 ? (
                            <span className="text-positive-ink">Is owed</span>
                          ) : entry.amount.amount < 0 ? (
                            <span className="text-caution-ink">Owes</span>
                          ) : (
                            <span className="text-ink-muted">Settled</span>
                          )}
                        </td>
                        <td className="text-ink px-4 py-3 text-right text-base font-medium tabular-nums">
                          {format(entry.amount)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))
          )}
        </section>

        {ledger.balances.length > 0 ? (
          <section aria-labelledby="settle-heading" className="flex flex-col gap-4">
            <div>
              <h2 id="settle-heading" className="font-display text-display-sm text-ink">
                Settle up
              </h2>
              <p className="text-ink-muted mt-2 max-w-[60ch] text-sm leading-relaxed">
                {everyoneSquare
                  ? 'Everyone is square.'
                  : 'The fewest payments that clear every balance. Ticking one is a note to yourself, kept on this device; it changes nobody’s balance.'}
              </p>
            </div>

            {ledger.settlements.map((group) =>
              group.transfers.length === 0 ? null : (
                <div
                  key={group.currency}
                  className="border-border bg-surface-raised rounded-(--radius-card) border px-4"
                >
                  <SettleChecklist
                    tripId={tripId}
                    currency={group.currency}
                    items={group.transfers.map((transfer) => ({
                      key: `${transfer.from}-${transfer.to}-${transfer.amount.amount}`,
                      from: nameOf(transfer.from),
                      to: nameOf(transfer.to),
                      amount: format(transfer.amount),
                    }))}
                  />
                </div>
              ),
            )}
          </section>
        ) : null}

        <section aria-labelledby="expenses-heading" className="flex flex-col gap-4">
          <h2 id="expenses-heading" className="font-display text-display-sm text-ink">
            All expenses
          </h2>

          {ledger.expenses.length === 0 ? (
            <p className="text-ink-muted text-sm">Nothing recorded.</p>
          ) : (
            <ul className="divide-border border-border divide-y border-y">
              {ledger.expenses.map((expense) => (
                <li key={expense.id} className="py-4">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
                    <div className="min-w-0">
                      <p className="text-ink text-base font-medium">{expense.description}</p>
                      <p className="text-ink-muted mt-0.5 text-sm">
                        <span className="tabular-nums">{shortDate(expense.date)}</span> &middot;
                        paid by {nameOf(expense.paidBy)}
                      </p>
                    </div>
                    <p className="text-ink text-lg font-medium tabular-nums">
                      {format(expense.amount)}
                    </p>
                  </div>

                  <div className="mt-2 flex flex-wrap items-start gap-x-2">
                    <Disclosure summary={`Edit ${expense.description}`} className="min-w-0 flex-1">
                      <ActionForm
                        action={updateExpenseAction}
                        submitLabel="Save changes"
                        savedMessage="Expense updated."
                        hidden={{ tripId, expenseId: expense.id }}
                        resetOnSave={false}
                      >
                        <ExpenseFields
                          members={members}
                          expense={expense}
                          defaultCurrency={defaultCurrency}
                          today={today}
                        />
                      </ActionForm>
                    </Disclosure>
                    <form action={removeExpenseAction}>
                      <input type="hidden" name="tripId" value={tripId} />
                      <input type="hidden" name="expenseId" value={expense.id} />
                      <Button type="submit" variant="ghost" size="md">
                        Remove<span className="sr-only"> {expense.description}</span>
                      </Button>
                    </form>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <div className="flex min-w-0 flex-col gap-8 lg:sticky lg:top-24 lg:h-fit">
        <aside
          aria-labelledby="add-expense-heading"
          className="border-border bg-surface-raised rounded-(--radius-card) border p-5"
        >
          <h3 id="add-expense-heading" className="text-ink mb-4 text-lg font-medium">
            Add an expense
          </h3>
          <ActionForm
            action={addExpenseAction}
            submitLabel="Add expense"
            pendingLabel="Adding…"
            savedMessage="Expense added."
            hidden={{ tripId }}
          >
            <ExpenseFields members={members} defaultCurrency={defaultCurrency} today={today} />
          </ActionForm>
        </aside>

        <section aria-labelledby="people-heading" className="flex flex-col gap-4">
          <h3 id="people-heading" className="text-ink flex items-center gap-2 text-lg font-medium">
            <Icon name="users" size={1.1} className="text-ink-muted" />
            People
          </h3>
          <ul className="flex flex-col">
            {members.map((member) => (
              <li
                key={member.id}
                className="border-border flex min-h-12 flex-wrap items-center gap-3 border-t py-1 first:border-t-0"
              >
                <MemberAvatars names={[member.name]} size="sm" />
                <span className="text-ink text-sm">
                  {member.name}
                  {member.id === selfId ? <span className="text-ink-muted"> (you)</span> : null}
                </span>
                {isOwner && member.id !== selfId ? (
                  <form action={removeMemberAction} className="ml-auto">
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
            <Disclosure summary="Add a person">
              <ActionForm
                action={addMemberAction}
                submitLabel="Add person"
                pendingLabel="Adding…"
                savedMessage="Added."
                hidden={{ tripId }}
              >
                <Field label="Name" name="name" required maxLength={80} autoComplete="off" />
                <Field
                  label="Their Voyagr email"
                  name="accountEmail"
                  type="email"
                  hint="Optional. If they have an account they can open this trip."
                  autoComplete="off"
                />
              </ActionForm>
            </Disclosure>
          ) : null}
        </section>
      </div>
    </div>
  );
}
