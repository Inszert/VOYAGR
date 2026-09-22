import { Button, DateRangeField, Field } from '@/components/ui';
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
  return (
    <form method="get" action={action} className="flex flex-col gap-4">
      {Object.entries(hidden).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Field
          label="Destination"
          name="destination"
          defaultValue={query.destination.name ?? ''}
          placeholder="Barcelona"
          hint="A city or an area."
          error={errors.destination}
          required
        />

        <div className="sm:col-span-2">
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
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field
            label="Guests"
            name="adults"
            type="number"
            min={1}
            max={16}
            defaultValue={String(query.occupancy.adults)}
            error={errors.adults}
            required
          />
          <Field
            label="Rooms"
            name="rooms"
            type="number"
            min={1}
            max={8}
            defaultValue={String(query.occupancy.rooms)}
            error={errors.rooms}
            required
          />
        </div>
      </div>

      <div>
        <Button type="submit">{submitLabel}</Button>
      </div>
    </form>
  );
}
