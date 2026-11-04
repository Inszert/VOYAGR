'use client';

import { useActionState } from 'react';
import { Button, Card, Field } from '@/components/ui';
import type { ResetPasswordState } from '@/app/actions/auth';

/**
 * Choosing a new password from a reset link.
 *
 * The token travels as a hidden field rather than being re-read from the
 * page's own URL inside the action, so the action's only input is the form -
 * consistent with every other action in this app never reaching into
 * `headers()` or the URL for something the caller already has.
 */
export function ResetPasswordForm({
  action,
  token,
}: {
  readonly action: (
    previous: ResetPasswordState,
    formData: FormData,
  ) => Promise<ResetPasswordState>;
  readonly token: string;
}) {
  const [state, formAction, pending] = useActionState(action, {});

  return (
    <Card as="section" aria-labelledby="reset-password-heading" className="mx-auto max-w-md">
      <h1 id="reset-password-heading" className="text-ink text-2xl font-semibold">
        Choose a new password
      </h1>

      <form action={formAction} className="mt-6 flex flex-col gap-4">
        <p role="alert" aria-live="polite" className="text-critical-ink text-sm empty:hidden">
          {state.error}
        </p>

        <input type="hidden" name="token" value={token} />

        <Field
          label="New password"
          name="password"
          type="password"
          autoComplete="new-password"
          hint="At least 12 characters. A memorable phrase works well."
          required
        />

        <Button type="submit" size="lg" loading={pending}>
          {pending ? 'Working…' : 'Set new password'}
        </Button>
      </form>
    </Card>
  );
}
