import type { Metadata } from 'next';
import Link from 'next/link';
import { AuthShell } from '@/components/auth/auth-shell';
import { PageHeader } from '@/components/ui';
import { ResetPasswordForm } from '@/components/auth/reset-password-form';
import { resetPasswordAction } from '@/app/actions/auth';

export const metadata: Metadata = {
  title: 'Choose a new password',
  description: 'Choose a new password for your account, from a link sent to your email.',
};

const SCENE = { code: 'CPT', line: 'Almost there. Choose a password and carry on.' } as const;

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { token } = await searchParams;

  if (!token || typeof token !== 'string') {
    return (
      <AuthShell scene={SCENE}>
        <PageHeader
          eyebrow="Account"
          title="That reset link is not valid"
          description={
            <>
              It may have expired or already been used. Request a new one from the{' '}
              <Link href="/forgot-password" className="text-brand-ink underline underline-offset-4">
                password reset page
              </Link>
              .
            </>
          }
        />
      </AuthShell>
    );
  }

  return (
    <AuthShell scene={SCENE}>
      <ResetPasswordForm action={resetPasswordAction} token={token} />
    </AuthShell>
  );
}
