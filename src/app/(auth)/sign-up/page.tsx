import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { AuthShell } from '@/components/auth/auth-shell';
import { CredentialsForm } from '@/components/auth/credentials-form';
import { signUpAction } from '@/app/actions/auth';
import { getCurrentUser } from '@/auth/current-user';
import { redirectTarget, safeNextPath } from '@/auth/return-to';
import { MIN_PASSWORD_LENGTH } from '@/auth/password-policy';

export const metadata: Metadata = {
  title: 'Create an account',
  description: 'Create an account to save searches, watch trips and plan them in one place.',
};

export default async function SignUpPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const next = safeNextPath(typeof params.next === 'string' ? params.next : undefined);

  if (await getCurrentUser()) redirect(redirectTarget(next, '/account'));

  return (
    <AuthShell
      scene={{ code: 'KEF', line: 'Let the search keep looking while you get on with your week.' }}
    >
      <CredentialsForm
        eyebrow="Get started"
        heading="Create an account"
        description="Save searches, keep watches on trips and plan them in one place."
        submitLabel="Create account"
        pendingLabel="Creating your account…"
        action={signUpAction}
        next={next}
        passwordAutoComplete="new-password"
        // Length, not composition rules: a long passphrase beats punctuation theatre.
        passwordHint={`At least ${MIN_PASSWORD_LENGTH} characters. A memorable phrase works well.`}
        footer={
          <>
            Already have an account?{' '}
            <Link
              href={next ? `/sign-in?next=${encodeURIComponent(next)}` : '/sign-in'}
              className="text-brand-ink underline underline-offset-4"
            >
              Sign in
            </Link>
            .
          </>
        }
      />
    </AuthShell>
  );
}
