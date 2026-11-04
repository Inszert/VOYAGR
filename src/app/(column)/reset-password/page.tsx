import type { Metadata } from 'next';
import Link from 'next/link';
import { ResetPasswordForm } from '@/components/auth/reset-password-form';
import { resetPasswordAction } from '@/app/actions/auth';

export const metadata: Metadata = { title: 'Choose a new password' };

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { token } = await searchParams;

  if (!token || typeof token !== 'string') {
    return (
      <div className="mx-auto max-w-md text-center">
        <h1 className="text-ink text-2xl font-semibold">That reset link is not valid</h1>
        <p className="text-ink-muted mt-2">
          Request a new one from the{' '}
          <Link href="/forgot-password" className="text-brand-ink underline underline-offset-4">
            password reset page
          </Link>
          .
        </p>
      </div>
    );
  }

  return <ResetPasswordForm action={resetPasswordAction} token={token} />;
}
