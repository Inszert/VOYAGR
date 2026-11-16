'use client';

import * as React from 'react';
import Link from 'next/link';
import { Button, Icon, Popover, PopoverPanel, PopoverTrigger } from '@/components/ui';
import type { PlanTrip } from '@/components/search/add-to-plan';
import { addToMyPlanAction } from '@/app/actions/trips';

/**
 * "Add this day to my plan" / "Add the whole plan": several places as ideas.
 *
 * The same action as one place's "Add to my plan", called once per place, in
 * order. Each lands as an idea, never a booking, and the outcome - how many
 * went in, or the first thing that stopped it - is announced in a live region.
 */

export interface PlanPlaceInput {
  readonly title: string;
  readonly url: string | null;
}

export function AddPlacesToPlan({
  places,
  trips,
  label,
  variant = 'ghost',
}: {
  places: readonly PlanPlaceInput[];
  trips: readonly PlanTrip[];
  /** The visible button text, e.g. "Add this day to my plan". */
  label: string;
  variant?: 'ghost' | 'secondary';
}) {
  const [open, setOpen] = React.useState(false);
  const [pending, startTransition] = React.useTransition();
  const [message, setMessage] = React.useState<{ text: string; ok: boolean } | null>(null);

  const add = (trip: PlanTrip) => {
    startTransition(async () => {
      let added = 0;
      for (const place of places) {
        const result = await addToMyPlanAction({
          tripId: trip.id,
          place: { title: place.title, kind: 'activity', url: place.url },
        });
        if (!result.ok) {
          setMessage({ ok: false, text: result.error });
          return;
        }
        added += 1;
      }
      setMessage({
        ok: true,
        text: `Added ${added} ${added === 1 ? 'place' : 'places'} to ${trip.name} as ideas.`,
      });
      setOpen(false);
    });
  };

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant={variant} size="md" aria-busy={pending || undefined}>
            <Icon name="plus" size={1} aria-hidden="true" />
            {label}
          </Button>
        </PopoverTrigger>
        <PopoverPanel align="start" className="w-64 p-1.5" aria-label="Choose a trip">
          <p className="text-ink-muted px-2.5 pt-1.5 pb-1 text-xs">Add them to which trip?</p>
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
