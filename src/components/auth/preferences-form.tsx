'use client';

import { useActionState } from 'react';
import { Button, Card, Field, Select } from '@/components/ui';
import {
  OPTIMISATION_MODES,
  OPTIMISATION_MODE_LABELS,
  TRAVEL_STYLES,
  TRAVEL_STYLE_LABELS,
} from '@/search/schema';
import type { ExplicitPreferences } from '@/auth/preferences';
import type { PreferencesFormState } from '@/app/actions/preferences';

/**
 * Explicit preferences.
 *
 * These pre-fill the search form and nothing else. A preference is a starting
 * point, never a hidden filter: a user who saved "direct flights only" and then
 * unticks it in a search gets connecting flights, because the search they are
 * looking at is the one that counts.
 */

export interface PreferencesFormProps {
  preferences: ExplicitPreferences;
  action: (state: PreferencesFormState, formData: FormData) => Promise<PreferencesFormState>;
}

function Checkbox({
  name,
  label,
  defaultChecked,
}: {
  name: string;
  label: string;
  defaultChecked: boolean;
}) {
  return (
    <label className="text-ink flex min-h-11 items-center gap-3 text-sm">
      <input
        type="checkbox"
        name={name}
        defaultChecked={defaultChecked}
        // `shrink-0`, because a flex item shrinks below its own size by
        // default: a long label was squeezing these 20px boxes to 13px, so
        // the product shipped oval checkboxes.
        className="border-border-strong text-brand-600 size-5 shrink-0 rounded-(--radius-control) border"
      />
      {label}
    </label>
  );
}

export function PreferencesForm({ preferences, action }: PreferencesFormProps) {
  const [state, formAction, pending] = useActionState<PreferencesFormState, FormData>(action, {});

  return (
    <Card as="section" aria-labelledby="preferences-heading">
      <h2 id="preferences-heading" className="text-ink text-xl font-semibold">
        What you told us
      </h2>
      <p className="text-ink-muted mt-1 text-sm">
        These pre-fill a new search. They never filter results behind your back.
      </p>

      <form action={formAction} className="mt-5 flex flex-col gap-5">
        <p role="alert" aria-live="polite" className="text-critical-ink text-sm empty:hidden">
          {state.error}
        </p>
        <p role="status" aria-live="polite" className="text-positive-ink text-sm empty:hidden">
          {state.saved ? 'Preferences saved.' : ''}
        </p>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Home airports"
            name="homeAirports"
            defaultValue={preferences.homeAirports?.join(', ') ?? ''}
            hint="Three-letter codes, separated by commas."
          />
          <Field
            label="Preferred currency"
            name="currency"
            defaultValue={preferences.currency ?? ''}
            hint="Three-letter code, such as EUR."
          />
          <Field
            label="Only alert me for savings of at least"
            name="alertMinimumSaving"
            type="number"
            min={0}
            step="1"
            hint="In the watch's own currency. Leave empty for every saving we would tell you about."
            defaultValue={preferences.alertMinimumSaving ?? ''}
          />
          <Field
            label="Usual number of travellers"
            name="defaultPassengers"
            type="number"
            min={1}
            max={9}
            defaultValue={preferences.defaultPassengers ?? ''}
          />
          <Select
            label="Travel style"
            name="travelStyle"
            defaultValue={preferences.travelStyle ?? 'balanced'}
            options={TRAVEL_STYLES.map((style) => ({
              value: style,
              label: TRAVEL_STYLE_LABELS[style],
            }))}
          />
          <Select
            label="Optimise for"
            name="optimisationMode"
            defaultValue={preferences.optimisationMode ?? 'best_value'}
            options={OPTIMISATION_MODES.map((mode) => ({
              value: mode,
              label: OPTIMISATION_MODE_LABELS[mode],
            }))}
          />
        </div>

        <div className="flex flex-col gap-3">
          <Checkbox
            name="requireDirectFlights"
            label="Usually want direct flights"
            defaultChecked={preferences.requireDirectFlights ?? false}
          />
          <Checkbox
            name="requireCheckedBaggage"
            label="Usually need checked baggage"
            defaultChecked={preferences.requireCheckedBaggage ?? false}
          />
          <Checkbox
            name="requireFreeCancellation"
            label="Usually want free cancellation"
            defaultChecked={preferences.requireFreeCancellation ?? false}
          />
        </div>

        <div>
          <Button type="submit" loading={pending}>
            {pending ? 'Saving…' : 'Save preferences'}
          </Button>
        </div>
      </form>
    </Card>
  );
}
