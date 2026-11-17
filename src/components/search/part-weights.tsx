'use client';

import * as React from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { setStagePending } from '@/components/discovery/stage-store';
import { PART_WEIGHT_PARAMS } from '@/search/part-weight-params';
import { weightWord } from './part-weight-words';

/**
 * "What matters most": one slider per part of the trip.
 *
 * It only re-orders. The sliders write `wFlights` / `wStay` / `wActivities` /
 * `wTransfers` into the address, and the server ranks with them; no figure is
 * computed here. A change applies on release (the native `change` event of a
 * range input), not on every pixel the thumb crosses.
 */

const PARTS = [
  { part: 'flights', label: 'Flights' },
  { part: 'stay', label: 'Stay' },
  { part: 'activities', label: 'Activities' },
  { part: 'transfers', label: 'Transfers' },
] as const;

export interface PartWeightsControlProps {
  /** The weights the page was ranked with, by part. 1 when absent. */
  values: Readonly<Record<(typeof PARTS)[number]['part'], number>>;
}

export function PartWeightsControl({ values }: PartWeightsControlProps) {
  const router = useRouter();
  const search = useSearchParams().toString();
  const [shown, setShown] = React.useState(values);

  // A navigation this control did not start (back, a link) is a different search.
  const incoming = JSON.stringify(values);
  const [seen, setSeen] = React.useState(incoming);
  if (seen !== incoming) {
    setSeen(incoming);
    setShown(values);
  }

  const apply = (part: (typeof PARTS)[number]['part'], value: number) => {
    const params = new URLSearchParams(search);
    const name = PART_WEIGHT_PARAMS[part];
    if (value === 1) params.delete(name);
    else params.set(name, String(value));
    params.delete('edit');
    setStagePending(true);
    router.push(`/explore?${params.toString()}` as never, { scroll: false });
  };

  return (
    <form
      onSubmit={(event) => event.preventDefault()}
      aria-label="What matters most"
      className="flex flex-col gap-2"
    >
      <p className="text-ink text-sm font-medium">What matters most</p>
      <p className="text-ink-muted text-xs">
        Re-orders Best match. Prices and scores never change.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        {PARTS.map(({ part, label }) => {
          const id = `weight-${part}`;
          return (
            <div key={part} className="flex flex-col gap-1">
              <label htmlFor={id} className="text-ink text-sm">
                {label}: <span className="text-ink-muted">{weightWord(shown[part])}</span>
              </label>
              <input
                id={id}
                name={PART_WEIGHT_PARAMS[part]}
                type="range"
                min={0}
                max={2}
                step={0.5}
                value={shown[part]}
                aria-valuetext={weightWord(shown[part])}
                onChange={(event) => {
                  const next = Number(event.currentTarget.value);
                  setShown((current) => ({ ...current, [part]: next }));
                }}
                onPointerUp={(event) => apply(part, Number(event.currentTarget.value))}
                onKeyUp={(event) => {
                  if (
                    event.key.startsWith('Arrow') ||
                    event.key === 'Home' ||
                    event.key === 'End'
                  ) {
                    apply(part, Number(event.currentTarget.value));
                  }
                }}
                className="accent-tint h-6 w-full cursor-pointer"
              />
            </div>
          );
        })}
      </div>
    </form>
  );
}
