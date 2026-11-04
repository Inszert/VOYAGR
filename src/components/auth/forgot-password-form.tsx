'use client';

import { useActionState } from 'react';
import { Button, Card, Field } from '@/components/ui';
import type { RequestPasswordResetState } from '@/app/actions/auth';

/**
 * Requesting a password reset link.
 *
 * One field, and the result is always the same sentence whether or not the
 * address is registered - `requestPasswordResetAction` holds that
 * discipline server-side, and this form just displays whatever it returns
 * rather than trying to be cleverer about it.
 */
export function ForgotPasswordForm({
  action,
}: {
  readonly action: (
    previous: RequestPasswordResetState,
    formData: FormData,
  ) => Promise<RequestPasswordResetState>;
}) {
  const [state, formAction, pending] = useActionState(action, {});

  return (
    <Card as="section" aria-labelledby="forgot-password-heading" className="mx-auto max-w-md">
      <h1 id="forgot-password-heading" className="text-ink text-2xl font-semibold">
        Reset your password
      </h1>

      <form action={formAction} className="mt-6 flex flex-col gap-4">
        <p role="status" aria-live="polite" className="text-positive-ink text-sm empty:hidden">
          {state.message}
        </p>

        {state.message ? null : (
          <Field label="Email" name="email" type="email" autoComplete="email" required />
        )}

        {state.message ? null : (
          <Button type="submit" size="lg" loading={pending}>
            {pending ? 'Sending…' : 'Send reset link'}
          </Button>
        )}
      </form>
    </Card>
  );
}
