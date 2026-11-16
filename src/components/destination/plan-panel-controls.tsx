'use client';

import * as React from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Icon } from '@/components/ui';
import { travellersLabel } from '@/core/party';

/**
 * How many are going: a stepper that changes the address.
 *
 * The price beside it is read on the server for a stated number of travellers,
 * so the count is not local state - it is `?passengers=` in the URL, and the
 * page re-renders with the figure for that many. The new price is therefore the
 * server's, never one worked out here. A pending change is `aria-busy`, the
 * outcome is announced, and the whole thing works as two plain buttons.
 */

const MIN = 1;
const MAX = 9;

export function TravellerStepper({ value }: { value: number }) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = React.useTransition();
  const [target, setTarget] = React.useState(value);
  const id = React.useId();

  // The server has answered with a count: that is the truth, whatever was pressed.
  const [seen, setSeen] = React.useState(value);
  if (seen !== value) {
    setSeen(value);
    setTarget(value);
  }

  const change = (next: number) => {
    if (next < MIN || next > MAX || next === target) return;
    setTarget(next);
    const params = new URLSearchParams(window.location.search);
    params.set('passengers', String(next));
    // The sheet's own parameter does not belong to a different party size.
    params.delete('place');
    startTransition(() => router.replace(`${pathname}?${params.toString()}`, { scroll: false }));
  };

  const button =
    'border-border text-ink hover:bg-surface-sunken ease-standard duration-quick inline-flex size-11 items-center justify-center rounded-full border active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-60 motion-reduce:active:scale-100';

  return (
    <div className="flex items-center justify-between gap-3" aria-busy={pending || undefined}>
      <span id={id} className="text-ink text-sm font-medium">
        Travellers
      </span>
      <div role="group" aria-labelledby={id} className="flex items-center gap-2">
        <button
          type="button"
          className={button}
          disabled={target <= MIN}
          onClick={() => change(target - 1)}
          aria-label="Fewer travellers"
        >
          <Icon name="minus" size={1} aria-hidden="true" />
        </button>
        <output
          aria-live="polite"
          className="text-ink min-w-[3.5rem] text-center text-sm font-semibold tabular-nums"
        >
          <span className="sr-only">{travellersLabel(target)}</span>
          <span aria-hidden="true">{target}</span>
        </output>
        <button
          type="button"
          className={button}
          disabled={target >= MAX}
          onClick={() => change(target + 1)}
          aria-label="More travellers"
        >
          <Icon name="plus" size={1} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
