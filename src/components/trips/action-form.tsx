'use client';

import { useActionState, useEffect, useId, useRef } from 'react';
import { Button } from '@/components/ui';
import type { TripFormState } from '@/app/actions/trips';

/**
 * A form that posts to a trip-hub Server Action and says how it went.
 *
 * The one client component the trip hub needs: the pages are server
 * components, and a form that cannot show "that did not add up" is a form that
 * fails silently. It resets itself after a save so the next entry starts empty.
 *
 * **How it reports.** The error is a sentence about the whole entry (the
 * server reads the form as one), so it sits in an always-mounted `alert`
 * region and, when it arrives, takes focus: a keyboard or screen-reader user
 * is put on the message instead of left on a button wondering why nothing
 * happened. The success line is a separate polite `status`. Both live above
 * the submit button's row, so neither is pushed off screen by the keyboard.
 *
 * Hidden ids (`tripId`, `itemId`) are passed as `hidden` and are claims, not
 * authority: the action re-checks access on every submit.
 */

export interface ActionFormProps {
  readonly action: (state: TripFormState, formData: FormData) => Promise<TripFormState>;
  readonly submitLabel: string;
  /** What the button says while the request is in flight. */
  readonly pendingLabel?: string;
  readonly savedMessage?: string;
  readonly hidden?: Readonly<Record<string, string>>;
  readonly resetOnSave?: boolean;
  readonly children: React.ReactNode;
}

export function ActionForm({
  action,
  submitLabel,
  pendingLabel = 'Saving…',
  savedMessage = 'Saved.',
  hidden = {},
  resetOnSave = true,
  children,
}: ActionFormProps) {
  const [state, formAction, pending] = useActionState<TripFormState, FormData>(action, {});
  const formRef = useRef<HTMLFormElement>(null);
  const errorRef = useRef<HTMLParagraphElement>(null);
  const errorId = useId();

  useEffect(() => {
    if (state.saved && resetOnSave) formRef.current?.reset();
  }, [state, resetOnSave]);

  useEffect(() => {
    if (state.error) errorRef.current?.focus();
  }, [state]);

  return (
    <form
      ref={formRef}
      action={formAction}
      aria-busy={pending || undefined}
      aria-describedby={state.error ? errorId : undefined}
      className="flex flex-col gap-5"
    >
      {Object.entries(hidden).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}

      <p
        ref={errorRef}
        id={errorId}
        tabIndex={-1}
        role="alert"
        className="border-critical-500/30 bg-critical-500/10 text-critical-ink rounded-(--radius-control) border px-3.5 py-2.5 text-sm empty:hidden"
      >
        {state.error}
      </p>

      {children}

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <Button type="submit" variant="primary" loading={pending}>
          {pending ? pendingLabel : submitLabel}
        </Button>
        <p role="status" className="text-positive-ink text-sm empty:hidden">
          {state.saved && !state.error ? savedMessage : null}
        </p>
      </div>
    </form>
  );
}
