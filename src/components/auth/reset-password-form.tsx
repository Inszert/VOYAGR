'use client';

import { useActionState, useId } from 'react';
import { Button, PageHeader, PasswordField } from '@/components/ui';
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
  const alertId = useId();

  return (
    <section aria-labelledby="reset-password-heading" className="flex flex-col gap-8">
      <PageHeader
        id="reset-password-heading"
        eyebrow="Account"
        title="Choose a new password"
        description="Pick something you have not used elsewhere. You will sign in with it straight after."
      />

      <form action={formAction} className="flex flex-col gap-5" aria-busy={pending || undefined}>
        <p
          id={alertId}
          role="alert"
          aria-live="polite"
          className="border-critical-500/30 bg-critical-500/10 text-critical-ink rounded-(--radius-control) border px-3.5 py-2.5 text-sm empty:hidden"
        >
          {state.error}
        </p>

        <input type="hidden" name="token" value={token} />

        <PasswordField
          label="New password"
          name="password"
          autoComplete="new-password"
          hint="At least 12 characters. A memorable phrase works well."
          invalid={Boolean(state.error)}
          describedBy={state.error ? alertId : undefined}
          required
        />

        <Button type="submit" size="lg" loading={pending} className="mt-1 w-full">
          {pending ? 'Saving…' : 'Set new password'}
        </Button>
      </form>
    </section>
  );
}
