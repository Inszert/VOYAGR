import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { AuthShell } from '@/components/auth/auth-shell';
import { CredentialsForm } from '@/components/auth/credentials-form';
import { signUpAction } from '@/app/actions/auth';
import { getCurrentUser } from '@/auth/current-user';
import { MIN_PASSWORD_LENGTH } from '@/auth/password-policy';

export const metadata: Metadata = { title: 'Create an account' };

export default async function SignUpPage() {
  if (await getCurrentUser()) redirect('/account');

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
        passwordAutoComplete="new-password"
        // Length, not composition rules: a long passphrase beats punctuation theatre.
        passwordHint={`At least ${MIN_PASSWORD_LENGTH} characters. A memorable phrase works well.`}
        footer={
          <>
            Already have an account?{' '}
            <Link href="/sign-in" className="text-brand-ink underline underline-offset-4">
              Sign in
            </Link>
            .
          </>
        }
      />
    </AuthShell>
  );
}
