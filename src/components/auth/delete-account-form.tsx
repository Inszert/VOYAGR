'use client';

import { useActionState } from 'react';
import { Button, Field } from '@/components/ui';
import type { DeleteAccountState } from '@/app/actions/auth';

/**
 * Deleting an account, deliberately.
 *
 * Typing the account's own email is the confirmation. A checkbox or a second
 * button is defeated by momentum; reproducing an address is not something a
 * stray click does. The check is repeated on the server, because a
 * confirmation enforced only here is decoration.
 *
 * The consequences are listed before the control rather than after it, in
 * plain terms and with no reassuring language: this is irreversible and the
 * page should say so before somebody starts typing.
 */
export function DeleteAccountForm({
  action,
  email,
}: {
  readonly action: (
    previous: DeleteAccountState,
    formData: FormData,
  ) => Promise<DeleteAccountState>;
  readonly email: string;
}) {
  const [state, formAction, pending] = useActionState(action, {});

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <p className="text-ink-muted text-sm">
        This removes your account, your saved searches, your Travel Watches and everything they have
        recorded. It cannot be undone, and we cannot recover any of it afterwards.
      </p>

      <Field
        label={`Type ${email} to confirm`}
        name="confirmEmail"
        type="email"
        autoComplete="off"
        required
        error={state.error}
      />

      <div>
        <Button type="submit" variant="danger" loading={pending}>
          {pending ? 'Deleting…' : 'Delete my account'}
        </Button>
      </div>
    </form>
  );
}
