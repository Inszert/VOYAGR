'use client';

import { useActionState } from 'react';
import { Button, Disclosure, Field } from '@/components/ui';
import type { WatchFormState } from '@/app/actions/watches';

/**
 * Watching a trip without searching for it first.
 *
 * The other way in is automatic: run a search and save it, and it is watched
 * from then on. This is for when somebody already knows what they want kept
 * an eye on. The fields are the ones a watch cannot guess; everything else is
 * the same default a search starts from, and the action runs it through the
 * same parser, so a trip that cannot be searched cannot be watched.
 *
 * Folded until asked for: most people arrive here to look at what they are
 * watching, not to add to it.
 */

export interface AddWatchFormProps {
  readonly action: (state: WatchFormState, formData: FormData) => Promise<WatchFormState>;
  /** Today, so a date cannot be picked in the past. */
  readonly today: string;
}

export function AddWatchForm({ action, today }: AddWatchFormProps) {
  const [state, formAction, pending] = useActionState<WatchFormState, FormData>(action, {});

  return (
    <Disclosure summary="Watch a trip by hand" defaultOpen={Boolean(state.error)}>
      <form action={formAction} className="flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field
            label="From"
            name="origins"
            required
            placeholder="VIE"
            hint="Airport codes, such as VIE."
            autoComplete="off"
          />
          <Field
            label="To"
            name="destinations"
            placeholder="anywhere"
            hint="Codes, or leave it as anywhere."
            autoComplete="off"
          />
          <Field label="Leave from" name="earliestDeparture" type="date" min={today} required />
          <Field label="Back by" name="latestReturn" type="date" min={today} required />
          <Field
            label="Shortest stay (nights)"
            name="minNights"
            type="number"
            min={1}
            defaultValue="3"
          />
          <Field
            label="Longest stay (nights)"
            name="maxNights"
            type="number"
            min={1}
            defaultValue="7"
          />
          <Field label="Travellers" name="passengers" type="number" min={1} defaultValue="2" />
          <Field
            label="Most the trip may cost (EUR)"
            name="maxBudget"
            type="number"
            min={1}
            step="1"
            required
          />
        </div>

        <Field
          label="Name"
          name="name"
          hint="Optional. Otherwise it is named after where it goes."
          autoComplete="off"
        />

        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" variant="primary" loading={pending}>
            {pending ? 'Starting…' : 'Start watching'}
          </Button>
          <p role="alert" className="text-critical-ink text-sm empty:hidden">
            {state.error}
          </p>
          <p role="status" className="text-positive-ink text-sm empty:hidden">
            {state.saved && !state.error ? 'Watching it. It is in the list above.' : null}
          </p>
        </div>
      </form>
    </Disclosure>
  );
}
