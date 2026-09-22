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
 *
 * Watches used to be listed here as well as in the primary navigation. One
 * destination with two names in one banner is two destinations as far as
 * anybody reading the page aloud is concerned, so it is in the primary
 * navigation only, where it is a place in the product rather than a property
 * of the session.
 */
export async function AccountNav() {
  const user = await getCurrentUser();

  if (!user) {
    return (
      <nav aria-label="Account" className="flex items-center gap-2 text-sm">
        <Link
          href="/sign-in"
          className="text-muted hover:text-text ease-standard duration-quick px-3 py-2 text-[14px] transition-colors"
        >
          Sign in
        </Link>
        <Link
          href="/sign-up"
          className="voyagr-cta ease-standard duration-quick inline-flex h-[38px] items-center rounded-[--radius-pill] px-4 text-[14px] font-medium transition-[filter]"
        >
          Create account
        </Link>
      </nav>
    );
  }

  return (
    <nav aria-label="Account" className="flex items-center gap-2 text-sm">
      <Link
        href="/account"
        className="voyagr-panel text-text ease-standard duration-quick flex h-[38px] items-center gap-2 rounded-[--radius-pill] pr-4 pl-1.5 text-[14px] transition-colors hover:border-[--color-stage-accent]"
      >
        {/*
          An initial rather than a photograph. The product has never asked for
          one, and a generated avatar is a picture of somebody who does not
          exist standing in for somebody who does.
        */}
        <span
          aria-hidden="true"
          className="voyagr-cta grid size-7 place-items-center rounded-full text-[12px] font-medium uppercase"
        >
          {user.email.slice(0, 1)}
        </span>
        {/* The email is the least ambiguous label for "which account is this?" */}
        <span className="max-w-[12rem] truncate">{user.email}</span>
      </Link>
    </nav>
  );
}
