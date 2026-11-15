import type { Metadata } from 'next';
import { AuthShell } from '@/components/auth/auth-shell';
import { ForgotPasswordForm } from '@/components/auth/forgot-password-form';
import { requestPasswordResetAction } from '@/app/actions/auth';

export const metadata: Metadata = { title: 'Reset your password' };

export default function ForgotPasswordPage() {
  return (
    <AuthShell
      scene={{ code: 'FAO', line: 'A new password, and back to the trip you were planning.' }}
    >
      <ForgotPasswordForm action={requestPasswordResetAction} />
    </AuthShell>
  );
}
