'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { Button, Field, PageHeader } from '@/components/ui';
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
    <section aria-labelledby="forgot-password-heading" className="flex flex-col gap-8">
      <PageHeader
        id="forgot-password-heading"
        eyebrow="Account"
        title="Reset your password"
        description="Enter the address you signed up with and we will send a link to choose a new one."
      />

      <form action={formAction} className="flex flex-col gap-5" aria-busy={pending || undefined}>
        <p
          role="status"
          aria-live="polite"
          className="border-positive-500/30 bg-positive-500/10 text-positive-ink rounded-(--radius-control) border px-3.5 py-2.5 text-sm empty:hidden"
        >
          {state.message}
        </p>

        {state.message ? null : (
          <Field label="Email" name="email" type="email" autoComplete="email" required />
        )}

        {state.message ? null : (
          <Button type="submit" size="lg" loading={pending} className="mt-1 w-full">
            {pending ? 'Sending…' : 'Send reset link'}
          </Button>
        )}
      </form>

      <p className="text-ink-muted text-sm">
        Remembered it?{' '}
        <Link href="/sign-in" className="text-brand-ink underline underline-offset-4">
          Back to sign in
        </Link>
        .
      </p>
    </section>
  );
}
