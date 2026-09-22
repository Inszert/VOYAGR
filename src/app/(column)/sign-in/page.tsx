import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { CredentialsForm } from '@/components/auth/credentials-form';
import { signInAction } from '@/app/actions/auth';
import { getCurrentUser } from '@/auth/current-user';

export const metadata: Metadata = { title: 'Sign in' };

export default async function SignInPage() {
  // Nobody needs to sign in twice.
  if (await getCurrentUser()) redirect('/account');

  return (
    <CredentialsForm
      heading="Sign in"
      submitLabel="Sign in"
      action={signInAction}
      passwordAutoComplete="current-password"
      footer={
        <>
          No account yet?{' '}
          <Link href="/sign-up" className="text-brand-ink underline underline-offset-4">
            Create one
          </Link>
          .
        </>
      }
    />
  );
}
