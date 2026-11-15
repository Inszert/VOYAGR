'use client';

import { useActionState } from 'react';
import { Button, Card, Field, PasswordField } from '@/components/ui';
import type { EmailChangeFormState } from '@/app/actions/auth';

/**
 * Change email address.
 *
 * Requires the current password, same as changing the password itself -
 * `AuthService.requestEmailChange` enforces this server-side too, so this
 * is about telling the user why the field is there, not the actual check.
 *
 * Submitting does not change anything yet: it sends a confirmation link to
 * the *new* address, and the account moves only once that link is clicked.
 */
export function EmailChangeForm({
  action,
}: {
  readonly action: (
    previous: EmailChangeFormState,
    formData: FormData,
  ) => Promise<EmailChangeFormState>;
}) {
  const [state, formAction, pending] = useActionState(action, {});

  return (
    <Card as="section" aria-labelledby="email-change-heading">
      <h2 id="email-change-heading" className="text-ink text-xl font-semibold">
        Change your email address
      </h2>
      <p className="text-ink-muted mt-1 text-sm">
        We will send a confirmation link to the new address. Nothing changes until you click it.
      </p>

      <form action={formAction} className="mt-5 flex max-w-md flex-col gap-4">
        <p role="alert" aria-live="polite" className="text-critical-ink text-sm empty:hidden">
          {state.error}
        </p>
        <p role="status" className="text-positive-ink text-sm empty:hidden">
          {state.message}
        </p>

        <PasswordField
          label="Current password"
          name="currentPassword"
          autoComplete="current-password"
          required
        />
        <Field label="New email" name="newEmail" type="email" autoComplete="email" required />

        <div>
          <Button type="submit" variant="secondary" loading={pending}>
            {pending ? 'Sending…' : 'Send confirmation link'}
          </Button>
        </div>
      </form>
    </Card>
  );
}
