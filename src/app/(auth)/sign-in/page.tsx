import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { AuthShell } from '@/components/auth/auth-shell';
import { CredentialsForm } from '@/components/auth/credentials-form';
import { signInAction } from '@/app/actions/auth';
import { getCurrentUser } from '@/auth/current-user';

export const metadata: Metadata = {
  title: 'Sign in',
  description: 'Sign in to see your saved searches, watches and trips.',
};

/**
 * Every action that redirects here does so as a bare `?flag=1` - only
 * whether the key is present matters, never its value. One lookup rather
 * than a growing ternary chain, so a fifth flag is a row, not a rewrite.
 */
const SIGN_IN_NOTICES: Record<string, string> = {
  passwordChanged: 'Password changed. Sign in with your new password.',
  reset: 'Password reset. Sign in with your new password.',
  signedOutEverywhere: 'Signed out of every device.',
  emailChanged: 'Email address changed. Sign in with your new address.',
};

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // Nobody needs to sign in twice.
  if (await getCurrentUser()) redirect('/account');

  const params = await searchParams;
  const flag = Object.keys(SIGN_IN_NOTICES).find((key) => params[key] !== undefined);
  const notice = flag ? SIGN_IN_NOTICES[flag] : null;

  return (
    <AuthShell scene={{ code: 'LIS', line: 'Pick up where your last search left off.' }}>
      <CredentialsForm
        eyebrow="Welcome back"
        heading="Sign in"
        description="Your saved searches, watches and trips are waiting."
        submitLabel="Sign in"
        pendingLabel="Signing in…"
        action={signInAction}
        passwordAutoComplete="current-password"
        notice={notice}
        footer={
          <>
            No account yet?{' '}
            <Link href="/sign-up" className="text-brand-ink underline underline-offset-4">
              Create one
            </Link>
            . Forgotten your password?{' '}
            <Link href="/forgot-password" className="text-brand-ink underline underline-offset-4">
              Reset it
            </Link>
            .
          </>
        }
      />
    </AuthShell>
  );
}
