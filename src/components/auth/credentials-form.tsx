'use client';

import { useActionState, useId } from 'react';
import { Button, Field, PageHeader, PasswordField } from '@/components/ui';
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
 *
 * The server's answer is one sentence about the attempt, not about a field
 * ("That email or password is not right" must not say which), so it sits above
 * the fields in a live region and both fields are described by it and marked
 * invalid. The message is announced when it arrives, and a screen reader
 * landing on either field hears it again.
 */

export interface CredentialsFormProps {
  eyebrow: string;
  heading: string;
  description: string;
  submitLabel: string;
  /** What the button says while the request is in flight: "Signing in…". */
  pendingLabel: string;
  action: (state: AuthFormState, formData: FormData) => Promise<AuthFormState>;
  passwordHint?: string;
  /** `new-password` on sign-up lets a password manager offer to generate one. */
  passwordAutoComplete: 'current-password' | 'new-password';
  /** A reason to be here that this form itself did not cause, e.g. "Password changed." */
  notice?: string | null;
  /** A validated same-origin path to return to after success, carried as a hidden field. */
  next?: string | null;
  footer: React.ReactNode;
}

export function CredentialsForm({
  eyebrow,
  heading,
  description,
  submitLabel,
  pendingLabel,
  action,
  passwordHint,
  passwordAutoComplete,
  notice,
  next,
  footer,
}: CredentialsFormProps) {
  const [state, formAction, pending] = useActionState<AuthFormState, FormData>(action, {});
  const alertId = useId();

  return (
    <section aria-labelledby="credentials-heading" className="flex flex-col gap-8">
      <PageHeader
        id="credentials-heading"
        eyebrow={eyebrow}
        title={heading}
        description={description}
      />

      {notice ? (
        <p
          role="status"
          className="border-positive-500/30 bg-positive-500/10 text-positive-ink rounded-(--radius-control) border px-3.5 py-2.5 text-sm"
        >
          {notice}
        </p>
      ) : null}

      <form action={formAction} className="flex flex-col gap-5" aria-busy={pending || undefined}>
        {next ? <input type="hidden" name="next" value={next} /> : null}
        {/*
          Always mounted, not conditionally rendered: a live region that appears
          at the same moment as its content is often missed by screen readers.
        */}
        <p
          id={alertId}
          role="alert"
          aria-live="polite"
          className="border-critical-500/30 bg-critical-500/10 text-critical-ink rounded-(--radius-control) border px-3.5 py-2.5 text-sm empty:hidden"
        >
          {state.error}
        </p>

        <Field
          label="Email"
          name="email"
          type="email"
          autoComplete="email"
          defaultValue={state.email}
          invalid={Boolean(state.error)}
          describedBy={state.error ? alertId : undefined}
          required
        />

        <PasswordField
          label="Password"
          name="password"
          autoComplete={passwordAutoComplete}
          hint={passwordHint}
          invalid={Boolean(state.error)}
          describedBy={state.error ? alertId : undefined}
          required
        />

        <Button type="submit" size="lg" loading={pending} className="mt-1 w-full">
          {pending ? pendingLabel : submitLabel}
        </Button>
      </form>

      <p className="text-ink-muted text-sm leading-relaxed">{footer}</p>
    </section>
  );
}
