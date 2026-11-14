'use client';

import { useActionState } from 'react';
import { Button, Card, Field } from '@/components/ui';
import type { AlertPreferencesFormState } from '@/app/actions/alert-preferences';

/**
 * Price-drop alert settings.
 *
 * These only narrow what the watch pipeline has already decided is worth an
 * alert; they never add one. Alerts are in-app and push - no email.
 *
 * Takes plain values rather than the repository record: the budget arrives as
 * the text to show, formatted on the server, so no money arithmetic happens in
 * the browser.
 */

export interface AlertPreferencesFormValues {
  readonly homeAirport: string;
  readonly destinations: string;
  readonly budget: string;
  readonly currency: string;
  readonly earliestDeparture: string;
  readonly latestDeparture: string;
  readonly priceDropAlerts: boolean;
}

export interface AlertPreferencesFormProps {
  values: AlertPreferencesFormValues;
  action: (
    state: AlertPreferencesFormState,
    formData: FormData,
  ) => Promise<AlertPreferencesFormState>;
}

function Checkbox({
  name,
  label,
  hint,
  defaultChecked,
}: {
  name: string;
  label: string;
  hint: string;
  defaultChecked: boolean;
}) {
  const hintId = `${name}-hint`;

  return (
    <div className="flex flex-col gap-1">
      <label className="text-ink flex items-center gap-3 text-sm">
        <input
          type="checkbox"
          name={name}
          defaultChecked={defaultChecked}
          aria-describedby={hintId}
          className="border-border-strong text-brand-600 size-5 shrink-0 rounded-(--radius-control) border"
        />
        {label}
      </label>
      <p id={hintId} className="text-ink-muted ps-8 text-sm">
        {hint}
      </p>
    </div>
  );
}

export function AlertPreferencesForm({ values, action }: AlertPreferencesFormProps) {
  const [state, formAction, pending] = useActionState<AlertPreferencesFormState, FormData>(
    action,
    {},
  );

  return (
    <Card as="section" aria-labelledby="alert-preferences-heading">
      <h2 id="alert-preferences-heading" className="text-ink text-xl font-semibold">
        Price-drop alerts
      </h2>
      <p className="text-ink-muted mt-1 text-sm">
        Narrow which drops reach you. Leave a field empty to mean anything.
      </p>

      <form action={formAction} className="mt-5 flex flex-col gap-5">
        <p role="alert" aria-live="polite" className="text-critical-ink text-sm empty:hidden">
          {state.error}
        </p>
        <p role="status" aria-live="polite" className="text-positive-ink text-sm empty:hidden">
          {state.saved ? 'Alert settings saved.' : ''}
        </p>

        <Checkbox
          name="priceDropAlerts"
          label="Alert me when a trip I am watching gets cheaper"
          hint="Only for drops big enough to matter. Alerts appear in the bell in the header, and as a push notification if you turned those on."
          defaultChecked={values.priceDropAlerts}
        />

        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Home airport"
            name="homeAirport"
            defaultValue={values.homeAirport}
            maxLength={3}
            autoCapitalize="characters"
            hint="Three-letter code, such as LHR."
          />
          <Field
            label="Only these destinations"
            name="destinations"
            defaultValue={values.destinations}
            hint="Three-letter codes, separated by commas. Leave empty for anywhere."
          />
          <Field
            label="Budget"
            name="budget"
            inputMode="decimal"
            defaultValue={values.budget}
            hint="The most an alerted trip may cost. Leave empty for no limit."
          />
          <Field
            label="Budget currency"
            name="currency"
            defaultValue={values.currency}
            maxLength={3}
            autoCapitalize="characters"
            hint="Three-letter code, such as EUR."
          />
          <Field
            label="Earliest departure"
            name="earliestDeparture"
            type="date"
            defaultValue={values.earliestDeparture}
          />
          <Field
            label="Latest departure"
            name="latestDeparture"
            type="date"
            defaultValue={values.latestDeparture}
          />
        </div>

        <div>
          <Button type="submit" loading={pending}>
            {pending ? 'Saving…' : 'Save alert settings'}
          </Button>
        </div>
      </form>
    </Card>
  );
}
