import Link from 'next/link';
import { SheetClose } from '@/components/ui';

/**
 * The account half of the phone header, and of its menu.
 *
 * The wide header keeps `AccountNav`; these are the two other places the same
 * facts appear below 1024px. They take the email rather than reading the
 * session, so the layout reads it once and the header never knows how.
 */

/** The one action the phone header keeps in view. */
export function HeaderPrimaryAction({ email }: { email: string | null }) {
  if (!email) {
    return (
      <Link
        href="/sign-up"
        className="voyagr-cta ease-standard duration-quick inline-flex h-11 items-center rounded-(--radius-pill) px-4 text-[14px] font-medium whitespace-nowrap transition-[filter]"
      >
        Create account
      </Link>
    );
  }

  return (
    <Link
      href="/account"
      className="voyagr-panel text-text ease-standard duration-quick grid size-11 place-items-center rounded-full transition-colors hover:border-(--color-stage-accent)"
    >
      <span
        aria-hidden="true"
        className="voyagr-cta grid size-8 place-items-center rounded-full text-[13px] font-medium uppercase"
      >
        {email.slice(0, 1)}
      </span>
      <span className="sr-only">Account: {email}</span>
    </Link>
  );
}

const ROW =
  'text-ink-muted hover:text-ink ease-standard duration-quick flex min-h-12 items-center rounded-(--radius-control) px-3 text-[16px] transition-colors';

/** The account links as the menu sheet lists them. */
export function MenuAccountLinks({ email }: { email: string | null }) {
  return (
    <nav aria-label="Account" className="flex flex-col gap-1">
      {email ? (
        <SheetClose asChild>
          <Link href="/account" className={ROW}>
            <span className="min-w-0 truncate">Account · {email}</span>
          </Link>
        </SheetClose>
      ) : (
        <>
          <SheetClose asChild>
            <Link href="/sign-in" className={ROW}>
              Sign in
            </Link>
          </SheetClose>
          <SheetClose asChild>
            <Link href="/sign-up" className={ROW}>
              Create account
            </Link>
          </SheetClose>
        </>
      )}
    </nav>
  );
}
