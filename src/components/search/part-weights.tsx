'use client';

import * as React from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { setStagePending } from '@/components/discovery/stage-store';
import { Button } from '@/components/ui/button';
import { PART_WEIGHT_PARAMS } from '@/search/part-weight-params';
import { weightWord } from './part-weight-words';

/**
 * "What matters most": one slider per part of the trip.
 *
 * It only re-orders. The sliders write `wStay` / `wTransfers` / `wCost` /
 * `wNature` / `wWeather` / `wFood` into the address, and the server ranks with them; no figure is
 * computed here. A change applies on release (the native `change` event of a
 * range input), not on every pixel the thumb crosses.
 *
 * Layout: one calm card. Each row has its name on the left and its current word on the
 * right, with the track beneath. Five tick marks under each track are the five stops, so
 * the word and the thumb's position agree. "Reset to
 * normal" only exists while something is not normal.
 */

const PARTS = [
  { part: 'stay', label: 'Stay' },
  { part: 'transfers', label: 'Transfers' },
  { part: 'cost', label: 'Cost' },
  { part: 'nature', label: 'Nature' },
  { part: 'weather', label: 'Weather' },
  { part: 'food', label: 'Food' },
] as const;

type Part = (typeof PARTS)[number]['part'];

const STOPS = [0, 0.5, 1, 1.5, 2] as const;

export interface PartWeightsControlProps {
  /** The weights the page was ranked with, by part. 1 when absent. */
  values: Readonly<Record<Part, number>>;
}

export function PartWeightsControl({ values }: PartWeightsControlProps) {
  const router = useRouter();
  const search = useSearchParams().toString();
  const [shown, setShown] = React.useState(values);
  const [open, setOpen] = React.useState(false);
  const panelId = React.useId();

  // A navigation this control did not start (back, a link) is a different search.
  const incoming = JSON.stringify(values);
  const [seen, setSeen] = React.useState(incoming);
  if (seen !== incoming) {
    setSeen(incoming);
    setShown(values);
  }

  const write = (mutate: (params: URLSearchParams) => void) => {
    const params = new URLSearchParams(search);
    mutate(params);
    params.delete('edit');
    setStagePending(true);
    router.push(`/explore?${params.toString()}` as never, { scroll: false });
  };

  const apply = (part: Part, value: number) =>
    write((params) => {
      const name = PART_WEIGHT_PARAMS[part];
      if (value === 1) params.delete(name);
      else params.set(name, String(value));
    });

  const reset = () => {
    setShown({ stay: 1, transfers: 1, cost: 1, nature: 1, weather: 1, food: 1 });
    write((params) => {
      for (const { part } of PARTS) params.delete(PART_WEIGHT_PARAMS[part]);
    });
  };

  const changed = PARTS.some(({ part }) => shown[part] !== 1);

  return (
    <form
      onSubmit={(event) => event.preventDefault()}
      aria-label="What matters most"
      className="border-border bg-surface-sunken min-w-0 rounded-(--radius-card) border p-4"
    >
      <Button
        type="button"
        variant="ghost"
        size="sm"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((current) => !current)}
        className="min-h-11 w-full justify-between"
      >
        What matters most
        <span aria-hidden="true" className="text-ink-muted">
          {open ? '−' : '+'}
        </span>
      </Button>
      <div id={panelId} hidden={!open} className="mt-3">
        <fieldset
          aria-describedby="weights-hint"
          className="m-0 flex min-w-0 flex-col gap-3 border-0 p-0"
        >
          <legend className="text-ink float-left w-full p-0 text-base font-medium">
            What matters most
          </legend>
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 flex-col gap-1">
              <p id="weights-hint" className="text-ink-muted text-sm">
                Re-orders Best match. Prices and scores never change.
              </p>
            </div>
            {changed ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-label="Reset what matters most to normal"
                onClick={reset}
                className="min-h-11 shrink-0"
              >
                Reset to normal
              </Button>
            ) : null}
          </div>
          <div className="divide-border flex flex-col divide-y">
            {PARTS.map(({ part, label }) => {
              const id = `weight-${part}`;
              const word = weightWord(shown[part]);
              return (
                <div key={part} className="flex flex-col gap-0.5 py-2.5 first:pt-0 last:pb-0">
                  <div className="flex items-baseline justify-between gap-3">
                    <label htmlFor={id} className="text-ink text-sm font-medium">
                      {label}
                    </label>
                    <span
                      aria-hidden="true"
                      className={
                        shown[part] === 1
                          ? 'text-ink-muted text-sm'
                          : 'text-ink text-sm font-medium'
                      }
                    >
                      {word}
                    </span>
                  </div>
                  <div className="flex min-w-0 flex-col">
                    <input
                      id={id}
                      name={PART_WEIGHT_PARAMS[part]}
                      type="range"
                      min={0}
                      max={2}
                      step={0.5}
                      value={shown[part]}
                      aria-valuetext={word}
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
                      className="accent-tint focus-visible:outline-accent-to h-8 w-full min-w-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2"
                    />
                    <span aria-hidden="true" className="flex justify-between px-2">
                      {STOPS.map((stop) => (
                        <span
                          key={stop}
                          className={
                            stop === 1 ? 'bg-ink-muted h-2 w-px' : 'bg-ink-muted/60 h-1.5 w-px'
                          }
                        />
                      ))}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </fieldset>
      </div>
    </form>
  );
}
