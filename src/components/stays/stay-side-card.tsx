import { format } from '@/core/money';
import type { IsoDate } from '@/core/trip/types';
import type { StayRate } from '@/core/stay/types';
import type { LocatorMap as LocatorMapData } from '@/discovery/locator';
import { Button, Card } from '@/components/ui';
import { CheckPrice } from './check-price';
import { LocatorMap } from './locator-map';
import { taxLines } from './rate-words';

/**
 * The hotel page's side card: the stay, the picked rate, the check, the steps still to come.
 * Every figure is the stored rate's own, formatted by `format()`; the live check says its own.
 */

export interface StaySideCardProps {
  readonly rate: StayRate;
  readonly hotelName: string;
  readonly checkIn: IsoDate;
  readonly checkOut: IsoDate;
  readonly nights: number;
  readonly adults: number;
  readonly rooms: number;
  readonly locator?: { readonly map: LocatorMapData; readonly label: string } | null;
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

export function StaySideCard({
  rate,
  hotelName,
  checkIn,
  checkOut,
  nights,
  adults,
  rooms,
  locator = null,
}: StaySideCardProps) {
  return (
    <Card surface="raised" className="flex flex-col gap-4 p-4">
      <h2 className="text-ink text-lg font-semibold">Your stay</h2>
      <p className="text-ink-muted text-sm">{hotelName}</p>

      <dl className="text-ink grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
        <dt className="text-ink-muted">Dates</dt>
        <dd className="tabular-nums">
          {checkIn} to {checkOut} ({plural(nights, 'night', 'nights')})
        </dd>
        <dt className="text-ink-muted">Party</dt>
        <dd>
          {plural(adults, 'adult', 'adults')}, {plural(rooms, 'room', 'rooms')}
        </dd>
      </dl>

      <div className="flex flex-col gap-0.5">
        <p className="text-ink text-xl font-semibold tabular-nums">{format(rate.total)} total</p>
        {taxLines(rate).map((line) => (
          <p key={line} className="text-ink-muted text-sm tabular-nums">
            {line}
          </p>
        ))}
      </div>

      <CheckPrice rate={rate} />

      <ol aria-label="Booking steps" className="flex flex-col gap-2">
        <li>
          <Button type="button" variant="secondary" disabled className="w-full">
            2. Guest details
          </Button>
        </li>
        <li>
          <Button type="button" variant="secondary" disabled className="w-full">
            3. Pay
          </Button>
        </li>
      </ol>
      <p className="text-ink-muted text-sm">Payments are not switched on yet</p>

      {locator ? <LocatorMap map={locator.map} label={locator.label} /> : null}
    </Card>
  );
}
