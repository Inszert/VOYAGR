'use client';

import { useActionState } from 'react';
import { Button, Card, PasswordField } from '@/components/ui';
import { MIN_PASSWORD_LENGTH } from '@/auth/password-policy';
import type { PasswordFormState } from '@/app/actions/auth';

/**
 * Change password.
 *
 * The form warns that it signs you out everywhere before you submit, because
 * that is exactly what it does and discovering it afterwards on three other
 * devices is a poor surprise.
 */

export interface PasswordFormProps {
  action: (state: PasswordFormState, formData: FormData) => Promise<PasswordFormState>;
}

export function PasswordForm({ action }: PasswordFormProps) {
  const [state, formAction, pending] = useActionState<PasswordFormState, FormData>(action, {});

  return (
    <Card as="section" aria-labelledby="password-heading">
      <h2 id="password-heading" className="text-ink text-xl font-semibold">
        Change your password
      </h2>
      <p className="text-ink-muted mt-1 text-sm">
        This signs you out on every device, including this one.
      </p>

      <form action={formAction} className="mt-5 flex max-w-md flex-col gap-4">
        <p role="alert" aria-live="polite" className="text-critical-ink text-sm empty:hidden">
          {state.error}
        </p>

        <PasswordField
          label="Current password"
          name="currentPassword"
          autoComplete="current-password"
          required
        />
        <PasswordField
          label="New password"
          name="newPassword"
          autoComplete="new-password"
          hint={`At least ${MIN_PASSWORD_LENGTH} characters.`}
          required
        />

        <div>
          <Button type="submit" variant="secondary" loading={pending}>
            {pending ? 'Changing…' : 'Change password'}
          </Button>
        </div>
      </form>
    </Card>
  );
}
