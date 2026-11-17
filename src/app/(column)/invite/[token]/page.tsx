import type { Metadata } from 'next';
import Link from 'next/link';
import { Button } from '@/components/ui';
import { acceptInviteAction } from '@/app/actions/trips';
import { getCurrentUser } from '@/auth/current-user';

/**
 * Where an invite link lands.
 *
 * The page never checks the token against the database: it says nothing about
 * the trip, or whether the link is good, until the person presses "Join this
 * trip" and the service decides. So the page cannot be used to probe links.
 * Kept out of search and sent with no referrer, because the address is the
 * secret.
 *
 * The sign-in flow has no "next" parameter, so a signed-out visitor signs in
 * and then opens the link again; the page says so rather than pretend.
 */

export const metadata: Metadata = {
  title: 'Join a trip',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

export default async function InvitePage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { token } = await params;
  const { failed } = await searchParams;
  const user = await getCurrentUser();

  return (
    <div className="flex max-w-xl flex-col gap-5">
      <h1 className="font-display text-display-sm text-ink text-balance">Join a trip</h1>

      {failed !== undefined ? (
        <p
          role="alert"
          className="border-critical-500/30 bg-critical-500/10 text-critical-ink rounded-(--radius-control) border px-3.5 py-2.5 text-sm"
        >
          This invite link is not valid any more. Ask for a new one.
        </p>
      ) : null}

      {user ? (
        <form action={acceptInviteAction} className="flex flex-col gap-4">
          <input type="hidden" name="token" value={token} />
          <p className="text-ink-muted text-sm leading-relaxed">
            You have been invited to a trip. Joining adds you to its plan and shared expenses.
          </p>
          <div>
            <Button type="submit" variant="primary">
              Join this trip
            </Button>
          </div>
        </form>
      ) : (
        <div className="flex flex-col gap-4">
          <p className="text-ink-muted text-sm leading-relaxed">
            You have been invited to a trip. Sign in to join it, then open this link again.
          </p>
          <div className="flex flex-wrap gap-4 text-sm">
            <Link href="/sign-in" className="text-brand-ink underline underline-offset-4">
              Sign in
            </Link>
            <Link href="/sign-up" className="text-brand-ink underline underline-offset-4">
              Create an account
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
