'use client';

import { useActionState } from 'react';
import Link from 'next/link';
import { Button, Card, Field } from '@/components/ui';
import type { WatchFormState } from '@/app/actions/watches';

/**
 * Turn the search on screen into a watch.
 *
 * The query string is posted back with it, so what gets saved is exactly the
 * search that produced these results rather than whatever the form happens to
 * contain by the time someone clicks.
 */

export interface SaveSearchFormProps {
  /** The query string this search ran with. */
  query: string;
  /** A starting name, derived from the search itself. */
  suggestedName: string;
  signedIn: boolean;
  action: (state: WatchFormState, formData: FormData) => Promise<WatchFormState>;
}

export function SaveSearchForm({ query, suggestedName, signedIn, action }: SaveSearchFormProps) {
  const [state, formAction, pending] = useActionState<WatchFormState, FormData>(action, {});

  if (!signedIn) {
    return (
      <Card as="section" aria-labelledby="save-search-heading">
        <h2 id="save-search-heading" className="text-ink text-lg font-semibold">
          Keep looking for this trip
        </h2>
        <p className="text-ink-muted mt-1 text-sm">
          <Link href="/sign-in" className="text-brand-ink underline underline-offset-4">
            Sign in
          </Link>{' '}
          and we will keep checking these dates after you close the tab.
        </p>
      </Card>
    );
  }

  if (state.saved) {
    return (
      <Card as="section" aria-labelledby="save-search-heading">
        <h2 id="save-search-heading" className="text-ink text-lg font-semibold">
          We are watching this trip
        </h2>
        <p role="status" className="text-ink-muted mt-1 text-sm">
          It is now on{' '}
          <Link href="/watches" className="text-brand-ink underline underline-offset-4">
            your watches
          </Link>
          , with its next check shown there.
        </p>
      </Card>
    );
  }

  return (
    /*
      Side by side once there is room for it.

      Stacked, this was a heading, a paragraph, a field and a button running
      down the page - four rows of vertical height for one small decision,
      sitting under a page that is already long. The two halves are the same
      markup in either layout; only the axis changes.
    */
    <Card
      as="section"
      aria-labelledby="save-search-heading"
      className="lg:flex lg:items-end lg:justify-between lg:gap-8"
    >
      <div className="lg:max-w-md">
        <h2 id="save-search-heading" className="text-ink text-lg font-semibold">
          Keep looking for this trip
        </h2>
        <p className="text-ink-muted mt-1 text-sm">
          We will re-run this search in the background and tell you if a materially better trip
          turns up.
        </p>
      </div>

      <form action={formAction} className="mt-4 flex flex-wrap items-end gap-3 lg:mt-0">
        <input type="hidden" name="query" value={query} />

        <div className="min-w-64 flex-1">
          <Field
            label="Name this search"
            name="name"
            defaultValue={suggestedName}
            required
            hint="So you can tell it apart from your other watches."
          />
        </div>

        <Button type="submit" loading={pending}>
          {pending ? 'Saving…' : 'Watch this trip'}
        </Button>

        {/*
          `--color-critical-500` is the ramp value, which is dark enough to
          drop under 4.5:1 on a dark surface. The `-ink` token is the one
          meant for this side of the palette.
        */}
        <p
          role="alert"
          aria-live="polite"
          className="text-critical-ink w-full text-sm empty:hidden"
        >
          {state.error}
        </p>
      </form>
    </Card>
  );
}
