'use client';

import { useActionState } from 'react';
import { Button, Card, Field } from '@/components/ui';
import type { AuthFormState } from '@/app/actions/auth';

/**
 * Sign-in and sign-up share one form.
 *
 * The two differ only in their heading, their action and their password hint.
 * Splitting them into near-identical components is how they drift apart - one
 * gaining an accessibility fix the other never gets.
 *
 * A client component, because it renders the server action's returned error
 * without a full navigation. It still submits as a real form, so it works
 * before the JavaScript arrives.
 */

export interface CredentialsFormProps {
  heading: string;
  submitLabel: string;
  action: (state: AuthFormState, formData: FormData) => Promise<AuthFormState>;
  passwordHint?: string;
  /** `new-password` on sign-up lets a password manager offer to generate one. */
  passwordAutoComplete: 'current-password' | 'new-password';
  /** A reason to be here that this form itself did not cause, e.g. "Password changed." */
  notice?: string | null;
  footer: React.ReactNode;
}

export function CredentialsForm({
  heading,
  submitLabel,
  action,
  passwordHint,
  passwordAutoComplete,
  notice,
  footer,
}: CredentialsFormProps) {
  const [state, formAction, pending] = useActionState<AuthFormState, FormData>(action, {});

  return (
    <Card as="section" aria-labelledby="credentials-heading" className="mx-auto max-w-md">
      <h1 id="credentials-heading" className="text-ink text-2xl font-semibold">
        {heading}
      </h1>

      {notice ? (
        <p role="status" className="text-positive-ink mt-2 text-sm">
          {notice}
        </p>
      ) : null}

      <form action={formAction} className="mt-6 flex flex-col gap-4">
        {/*
          Always mounted, not conditionally rendered: a live region that appears
          at the same moment as its content is often missed by screen readers.
        */}
        <p role="alert" aria-live="polite" className="text-critical-ink text-sm empty:hidden">
          {state.error}
        </p>

        <Field
          label="Email"
          name="email"
          type="email"
          autoComplete="email"
          defaultValue={state.email}
          required
        />

        <Field
          label="Password"
          name="password"
          type="password"
          autoComplete={passwordAutoComplete}
          hint={passwordHint}
          required
        />

        <Button type="submit" size="lg" loading={pending}>
          {pending ? 'Working…' : submitLabel}
        </Button>
      </form>

      <p className="text-ink-muted mt-6 text-sm">{footer}</p>
    </Card>
  );
}
