'use client';

import * as React from 'react';
import { Button, DateRangeField, Disclosure, Field, NumberStepperField } from '@/components/ui';
import { shortDateRange } from '@/lib/display-date';
import type { StayQuery } from '@/core/stay/types';
import type { IsoDate } from '@/core/trip/types';

/**
 * What a stay search needs, and nothing else.
 *
 * A plain GET form, like every other search here: it works before JavaScript
 * arrives, and submitting it produces a URL somebody can share. The dates go
 * through the same `DateRangeField` the trip search uses, so check-in and
 * check-out are one calendar showing the nights between - not two pickers
 * and a sum the reader has to do.
 */

export interface StaySearchFormProps {
  readonly query: StayQuery;
  readonly today: IsoDate;
  readonly errors?: Readonly<Record<string, string>>;
  /** Carried through the form so the flow returns to the right step. */
  readonly hidden?: Readonly<Record<string, string>>;
  readonly action?: string;
  readonly submitLabel?: string;
}

export function StaySearchForm({
  query,
  today,
  errors = {},
  hidden = {},
  action = '/stays',
  submitLabel = 'Search stays',
}: StaySearchFormProps) {
  const wrapperRef = React.useRef<HTMLDivElement | null>(null);
  const hasErrors = Object.keys(errors).length > 0;

  /*
   * Open until proven narrow. The server (and anybody without JavaScript)
   * gets the whole form; on a phone it folds away behind "Change search" once
   * the page is live, unless something needs fixing in it.
   */
  React.useEffect(() => {
    if (hasErrors || typeof window.matchMedia !== 'function') return;
    if (!window.matchMedia('(max-width: 767px)').matches) return;
    const details = wrapperRef.current?.querySelector('details');
    if (details) details.open = false;
  }, [hasErrors]);

  const guests = query.occupancy.adults;
  const summary = [
    query.destination.name ?? 'Anywhere',
    shortDateRange(query.checkIn, query.checkOut),
    `${guests} ${guests === 1 ? 'guest' : 'guests'}`,
  ].join(' · ');

  return (
    <div ref={wrapperRef} className="flex flex-col gap-2">
      <p className="text-ink text-sm md:hidden" data-testid="stay-search-summary">
        {summary}
      </p>

      <Disclosure
        summary="Change search"
        defaultOpen
        className="md:border-0 md:[&>div]:border-0 md:[&>div]:p-0 md:[&>summary]:hidden"
      >
        <form
          method="get"
          action={action}
          className="grid gap-4 md:grid-cols-2 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,2fr)_minmax(0,7.5rem)_minmax(0,7.5rem)_auto] lg:items-start"
        >
          {Object.entries(hidden).map(([name, value]) => (
            <input key={name} type="hidden" name={name} value={value} />
          ))}

          <Field
            label="Destination"
            name="destination"
            defaultValue={query.destination.name ?? ''}
            placeholder="Barcelona"
            error={errors.destination}
            required
          />

          <DateRangeField
            startLabel="Check-in"
            startName="checkIn"
            startValue={query.checkIn}
            startError={errors.checkIn}
            endLabel="Check-out"
            endName="checkOut"
            endValue={query.checkOut}
            endError={errors.checkOut}
            min={today}
            required
          />

          <NumberStepperField
            label="Guests"
            name="adults"
            min={1}
            max={16}
            defaultValue={String(query.occupancy.adults)}
            error={errors.adults}
            required
          />
          <NumberStepperField
            label="Rooms"
            name="rooms"
            min={1}
            max={8}
            defaultValue={String(query.occupancy.rooms)}
            error={errors.rooms}
            required
          />

          <Button type="submit" className="md:col-span-2 lg:col-span-1 lg:mt-7">
            {submitLabel}
          </Button>
        </form>
      </Disclosure>
    </div>
  );
}
