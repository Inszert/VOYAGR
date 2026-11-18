'use client';

import * as React from 'react';
import Link from 'next/link';
import { createTripAction, type TripFormState } from '@/app/actions/trips';
import { Button, Field } from '@/components/ui';
import { saveTripToBrowser } from '@/lib/preferences';

/**
 * "Save this trip".
 *
 * Signed in, it files the trip in the account through the existing trip action.
 * Signed out, it keeps it in this browser until the person signs in - said
 * plainly, so nobody thinks it is in an account. Only words and dates are kept:
 * the prices are recomputed when the trip is reopened.
 */

export interface SaveTripProps {
  readonly signedIn: boolean;
  readonly name: string;
  readonly destination: string;
  readonly startDate: string;
  readonly endDate: string;
  /** The explorer address that reopens this trip. */
  readonly href: string;
}

function browserStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function SaveTrip({ signedIn, name, destination, startDate, endDate, href }: SaveTripProps) {
  const [state, formAction, pending] = React.useActionState<TripFormState, FormData>(
    createTripAction,
    {},
  );
  const [kept, setKept] = React.useState<'saved' | 'failed' | null>(null);

  if (signedIn) {
    return (
      <form action={formAction} className="flex flex-col gap-2">
        <input type="hidden" name="name" value={name} />
        <input type="hidden" name="destination" value={destination} />
        <input type="hidden" name="startDate" value={startDate} />
        <input type="hidden" name="endDate" value={endDate} />
        <Field
          label="Your name on this trip"
          name="ownerName"
          required
          maxLength={80}
          autoComplete="off"
        />
        <Button type="submit" variant="secondary" size="md" disabled={pending}>
          Save this trip
        </Button>
        <p role="status" className="text-critical-ink text-sm empty:hidden">
          {state.error ?? ''}
        </p>
      </form>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <Button
        type="button"
        variant="secondary"
        size="md"
        onClick={() =>
          setKept(
            saveTripToBrowser(browserStorage(), { name, destination, startDate, endDate, href })
              ? 'saved'
              : 'failed',
          )
        }
      >
        Save this trip
      </Button>
      <p role="status" className="text-ink-muted text-sm empty:hidden">
        {kept === 'saved' ? (
          <>
            Saved in this browser.{' '}
            <Link href="/sign-in" className="text-tint-ink underline underline-offset-4">
              Sign in
            </Link>{' '}
            to keep it in your account.
          </>
        ) : kept === 'failed' ? (
          'This browser would not keep it. Sign in to save it to your account.'
        ) : null}
      </p>
    </div>
  );
}
