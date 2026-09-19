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
    <Card as="section" aria-labelledby="save-search-heading">
      <h2 id="save-search-heading" className="text-ink text-lg font-semibold">
        Keep looking for this trip
      </h2>
      <p className="text-ink-muted mt-1 text-sm">
        We will re-run this search in the background and tell you if a materially better trip turns
        up.
      </p>

      <form action={formAction} className="mt-4 flex flex-wrap items-end gap-3">
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
      </form>

      <p role="alert" aria-live="polite" className="text-critical-500 mt-2 text-sm empty:hidden">
        {state.error}
      </p>
    </Card>
  );
}
