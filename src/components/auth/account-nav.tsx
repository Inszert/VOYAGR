import Link from 'next/link';
import { getCurrentUser } from '@/auth/current-user';

/**
 * Header navigation that knows whether anyone is signed in.
 *
 * A server component, so the session is read on the server and no identity is
 * shipped to the client to be re-checked. It renders the signed-out version
 * when there is no session rather than hiding the navigation entirely: a
 * visitor who cannot see a way in does not have an account, they have a dead
 * end.
 */
export async function AccountNav() {
  const user = await getCurrentUser();

  if (!user) {
    return (
      <nav aria-label="Account" className="flex items-center gap-4 text-sm">
        <Link href="/sign-in" className="text-ink underline underline-offset-4">
          Sign in
        </Link>
        <Link href="/sign-up" className="text-brand-ink underline underline-offset-4">
          Create account
        </Link>
      </nav>
    );
  }

  return (
    <nav aria-label="Account" className="flex items-center gap-4 text-sm">
      <Link href="/watches" className="text-ink underline underline-offset-4">
        Watches
      </Link>
      <Link href="/account" className="text-ink underline underline-offset-4">
        {/* The email is the least ambiguous label for "which account is this?" */}
        {user.email}
      </Link>
    </nav>
  );
}
