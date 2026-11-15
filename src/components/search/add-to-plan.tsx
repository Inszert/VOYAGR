'use client';

import * as React from 'react';
import Link from 'next/link';
import { Button, Icon, Popover, PopoverPanel, PopoverTrigger } from '@/components/ui';
import { addToMyPlanAction } from '@/app/actions/trips';

/**
 * "Add to my plan", for a partner offer, for somebody signed in.
 *
 * Opens a short list of the person's own trips and a way to start a new one.
 * It adds an idea, never a booking: we cannot see what happens on a partner's
 * site, and the plan says so. The outcome is announced in a live region.
 */

export interface PlanTrip {
  readonly id: string;
  readonly name: string;
}

export function AddToPlan({
  offerId,
  trips,
  partner,
}: {
  offerId: string;
  trips: readonly PlanTrip[];
  partner: string;
}) {
  const [open, setOpen] = React.useState(false);
  const [pending, startTransition] = React.useTransition();
  const [message, setMessage] = React.useState<{ text: string; ok: boolean } | null>(null);

  const add = (trip: PlanTrip) => {
    startTransition(async () => {
      const result = await addToMyPlanAction({ offerId, tripId: trip.id });
      setMessage(
        result.ok
          ? { ok: true, text: `Added to ${trip.name} as an idea.` }
          : { ok: false, text: result.error },
      );
      if (result.ok) setOpen(false);
    });
  };

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="ghost" size="md" aria-busy={pending || undefined}>
            <Icon name="plus" size={1} aria-hidden="true" />
            Add to my plan
            <span className="sr-only"> ({partner})</span>
          </Button>
        </PopoverTrigger>
        <PopoverPanel align="start" className="w-64 p-1.5" aria-label="Choose a trip">
          <p className="text-ink-muted px-2.5 pt-1.5 pb-1 text-xs">Add it to which trip?</p>
          <ul className="flex flex-col">
            {trips.map((trip) => (
              <li key={trip.id}>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => add(trip)}
                  className="text-ink hover:bg-surface-raised flex min-h-11 w-full items-center rounded-(--radius-control) px-2.5 text-left text-sm active:scale-[0.97] motion-reduce:active:scale-100"
                >
                  {trip.name}
                </button>
              </li>
            ))}
            <li>
              <Link
                href="/trips"
                className="text-tint-ink hover:bg-surface-raised flex min-h-11 w-full items-center gap-2 rounded-(--radius-control) px-2.5 text-sm font-medium"
              >
                <Icon name="plus" size={0.95} aria-hidden="true" />
                New trip
              </Link>
            </li>
          </ul>
        </PopoverPanel>
      </Popover>
      <p
        role="status"
        className={`text-sm ${message ? (message.ok ? 'text-positive-ink' : 'text-critical-ink') : 'sr-only'}`}
      >
        {message?.text ?? ''}
      </p>
    </div>
  );
}
