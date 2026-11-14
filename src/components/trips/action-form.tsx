'use client';

import { useActionState, useEffect, useRef } from 'react';
import { Button } from '@/components/ui';
import type { TripFormState } from '@/app/actions/trips';

/**
 * A form that posts to a trip-hub Server Action and says how it went.
 *
 * The one client component the trip hub needs: the pages are server
 * components, and a form that cannot show "that did not add up" is a form that
 * fails silently. It resets itself after a save so the next entry starts empty.
 *
 * Hidden ids (`tripId`, `itemId`) are passed as `hidden` and are claims, not
 * authority: the action re-checks access on every submit.
 */

export interface ActionFormProps {
  readonly action: (state: TripFormState, formData: FormData) => Promise<TripFormState>;
  readonly submitLabel: string;
  readonly savedMessage?: string;
  readonly hidden?: Readonly<Record<string, string>>;
  readonly resetOnSave?: boolean;
  readonly children: React.ReactNode;
}

export function ActionForm({
  action,
  submitLabel,
  savedMessage = 'Saved.',
  hidden = {},
  resetOnSave = true,
  children,
}: ActionFormProps) {
  const [state, formAction, pending] = useActionState<TripFormState, FormData>(action, {});
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.saved && resetOnSave) formRef.current?.reset();
  }, [state, resetOnSave]);

  return (
    <form ref={formRef} action={formAction} className="flex flex-col gap-4">
      {Object.entries(hidden).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      {children}
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" variant="primary" loading={pending}>
          {submitLabel}
        </Button>
        <p role="status" className="text-sm empty:hidden">
          {state.error ? (
            <span className="text-critical-ink">{state.error}</span>
          ) : state.saved ? (
            <span className="text-positive-ink">{savedMessage}</span>
          ) : null}
        </p>
      </div>
    </form>
  );
}
