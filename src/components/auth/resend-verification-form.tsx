'use client';

import { useActionState } from 'react';
import { Button } from '@/components/ui';
import type { ResendVerificationState } from '@/app/actions/auth';

/**
 * "Confirm your email" nudge.
 *
 * One button, no confirmation step - unlike deleting an account, resending a
 * verification email is fully reversible and asking for it twice costs
 * nothing but a click. The result replaces the button's own label rather
 * than opening a separate banner, so the state that changed is the thing the
 * eye is already on.
 */
export function ResendVerificationForm({
  action,
}: {
  readonly action: (
    previous: ResendVerificationState,
    formData: FormData,
  ) => Promise<ResendVerificationState>;
}) {
  const [state, formAction, pending] = useActionState(action, {});

  return (
    <form action={formAction} className="flex flex-col gap-2">
      <Button type="submit" variant="secondary" size="sm" disabled={pending}>
        {pending ? 'Sending…' : 'Resend verification email'}
      </Button>
      {state.message ? (
        <p role="status" className="text-positive-ink text-sm">
          {state.message}
        </p>
      ) : null}
      {state.error ? (
        <p role="alert" className="text-critical-ink text-sm">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}
