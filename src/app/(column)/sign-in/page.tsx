import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { CredentialsForm } from '@/components/auth/credentials-form';
import { signInAction } from '@/app/actions/auth';
import { getCurrentUser } from '@/auth/current-user';

export const metadata: Metadata = { title: 'Sign in' };

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // Nobody needs to sign in twice.
  if (await getCurrentUser()) redirect('/account');

  const params = await searchParams;
  // Every action that lands here does so as a bare `?flag=1` - only whether
  // the key is present matters, never its value.
  const notice =
    params.passwordChanged !== undefined
      ? 'Password changed. Sign in with your new password.'
      : params.reset !== undefined
        ? 'Password reset. Sign in with your new password.'
        : params.signedOutEverywhere !== undefined
          ? 'Signed out of every device.'
          : null;

  return (
    <CredentialsForm
      heading="Sign in"
      submitLabel="Sign in"
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
  );
}
