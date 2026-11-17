'use client';

import * as React from 'react';
import Link from 'next/link';
import {
  addDayStopAction,
  loadDayPlanAction,
  moveDayStopAction,
  removeDayStopAction,
  startDayPlanAction,
  type DayPlanResult,
} from '@/app/actions/trips';
import type { PlanTrip } from '@/components/search/add-to-plan';
import { Button, Field, Icon, Select } from '@/components/ui';
import type { FirstPlan } from '@/discovery/first-plan';
import { PLACE_LINK_REL } from '@/trip-hub/place-url';
import type { DayPlanView, MoveDirection } from '@/trip-hub/day-plan';
import { usePlaces } from './places-context';

/**
 * "Your own plan": the signed-in person's editable copy of a day-by-day plan.
 *
 * It lives in a trip of theirs, as ordinary plan items with a day and an
 * order, so the trip page shows the same stops. Every change is a Server Action
 * that returns the plan as it was saved, and the page shows that, never its own
 * guess. Moving is by buttons, so the whole thing works from the keyboard.
 * There is no money here and nothing is booked.
 */

const NEW_TRIP = '';

const MOVES: readonly {
  readonly direction: MoveDirection;
  readonly icon: 'chevron-up' | 'chevron-down' | 'chevron-left' | 'chevron-right';
  readonly label: string;
}[] = [
  { direction: 'up', icon: 'chevron-up', label: 'earlier in the day' },
  { direction: 'down', icon: 'chevron-down', label: 'later in the day' },
  { direction: 'previous-day', icon: 'chevron-left', label: 'to the day before' },
  { direction: 'next-day', icon: 'chevron-right', label: 'to the day after' },
];

const ICON_BUTTON =
  'border-border text-ink hover:bg-surface-sunken ease-standard duration-quick inline-flex size-11 items-center justify-center rounded-(--radius-control) border active:scale-[0.97] aria-disabled:opacity-40 motion-reduce:active:scale-100';

export function MyDayPlan({
  plan,
  trips,
}: {
  /** The first plan on the page, copied when a new plan is started. */
  plan: FirstPlan;
  trips: readonly PlanTrip[];
}) {
  const { things, city } = usePlaces();
  const [view, setView] = React.useState<DayPlanView | null>(null);
  const [tripId, setTripId] = React.useState(trips[0]?.id ?? NEW_TRIP);
  const [pending, startTransition] = React.useTransition();
  const [message, setMessage] = React.useState<{ text: string; ok: boolean } | null>(null);
  const [addDay, setAddDay] = React.useState('1');
  const [placeId, setPlaceId] = React.useState('');
  const [typed, setTyped] = React.useState('');
  const focusAfter = React.useRef<{ id: string; direction: MoveDirection } | null>(null);
  const root = React.useRef<HTMLDivElement>(null);

  // After a stop changes day it is a new element; give the focus back to the
  // same control so a keyboard user can keep going.
  React.useEffect(() => {
    const target = focusAfter.current;
    if (!target) return;
    focusAfter.current = null;
    root.current
      ?.querySelector<HTMLElement>(
        `[data-stop-id="${target.id}"] [data-move="${target.direction}"]`,
      )
      ?.focus();
  }, [view]);

  const apply = (work: () => Promise<DayPlanResult>, done: string, onOk?: () => void) => {
    startTransition(async () => {
      const result = await work();
      if (!result.ok) {
        setMessage({ ok: false, text: result.error });
        return;
      }
      setView(result.plan);
      setMessage({ ok: true, text: done });
      onOk?.();
    });
  };

  const start = () =>
    apply(
      () =>
        startDayPlanAction({
          destination: city,
          days: plan.days.map((day) =>
            day.stops.map((stop) => ({ title: stop.place.name, url: stop.place.wikipediaUrl })),
          ),
        }),
      'Your plan is saved as a new trip.',
    );

  const open = () => {
    if (tripId === NEW_TRIP) return;
    apply(() => loadDayPlanAction(tripId), 'Opened your plan.');
  };

  if (!view) {
    return (
      <div className="border-border flex flex-col gap-3 border-t pt-4">
        <h3 className="font-display text-ink text-xl">Make it your own</h3>
        <p className="text-ink-muted max-w-xl text-sm">
          Copy this plan into a trip of yours, then reorder it, move stops between days, remove them
          or add your own. It is saved as you go.
        </p>
        <div className="flex flex-wrap items-end gap-3">
          <Button
            type="button"
            size="md"
            onClick={start}
            aria-busy={pending || undefined}
            disabled={pending}
          >
            <Icon name="plus" size={1} aria-hidden="true" />
            Start my own plan
          </Button>
          {trips.length > 0 ? (
            <>
              <Select
                label="Or edit the plan in"
                value={tripId}
                onChange={(event) => setTripId(event.target.value)}
                options={trips.map((trip) => ({ value: trip.id, label: trip.name }))}
              />
              <Button type="button" variant="secondary" size="md" onClick={open} disabled={pending}>
                Edit this plan
              </Button>
            </>
          ) : null}
        </div>
        <p
          role="status"
          className={message?.ok === false ? 'text-critical-500 text-sm' : 'sr-only'}
        >
          {message?.text}
        </p>
      </div>
    );
  }

  const lastDay = view.days.length;
  const stopCount = view.days.reduce((total, day) => total + day.stops.length, 0);

  const move = (id: string, direction: MoveDirection, title: string) => {
    focusAfter.current = { id, direction };
    apply(
      () => moveDayStopAction({ tripId: view.tripId, itemId: id, direction }),
      `Moved ${title}. Saved.`,
    );
  };

  const add = (stop: { title: string; url: string | null }, onOk?: () => void) =>
    apply(
      () => addDayStopAction({ tripId: view.tripId, day: Number(addDay), stop }),
      `Added ${stop.title} to day ${addDay}. Saved.`,
      onOk,
    );

  const chosen = things.find((thing) => thing.id === placeId);
  const dayOptions = Array.from({ length: Math.min(lastDay + 1, 14) }, (_, index) => ({
    value: String(index + 1),
    label: index + 1 > lastDay ? `Day ${index + 1} (new)` : `Day ${index + 1}`,
  }));

  return (
    <div ref={root} className="border-border flex flex-col gap-5 border-t pt-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h3 className="font-display text-ink text-xl">Your plan in {view.tripName}</h3>
        <Link
          href={`/trips/${view.tripId}`}
          className="text-tint-ink inline-flex min-h-11 items-center text-sm underline underline-offset-4"
        >
          Open the trip
        </Link>
      </div>
      <p
        role="status"
        className={message?.ok === false ? 'text-critical-500 text-sm' : 'text-ink-muted text-sm'}
      >
        {message ? message.text : `${stopCount} ${stopCount === 1 ? 'stop' : 'stops'}, saved.`}
      </p>

      <div className="flex flex-col gap-6">
        {view.days.map((day) => (
          <section
            key={day.day}
            aria-labelledby={`my-day-${day.day}`}
            className="flex flex-col gap-2"
          >
            <h4 id={`my-day-${day.day}`} className="text-ink text-base font-medium">
              Day {day.day}
            </h4>
            {day.stops.length === 0 ? (
              <p className="text-ink-muted text-sm">Nothing yet. Add a stop below.</p>
            ) : (
              <ol className="flex flex-col gap-2">
                {day.stops.map((stop, index) => {
                  const blocked = (direction: MoveDirection) =>
                    (direction === 'up' && index === 0) ||
                    (direction === 'down' && index === day.stops.length - 1) ||
                    (direction === 'previous-day' && day.day === 1) ||
                    (direction === 'next-day' && day.day >= 14);

                  return (
                    <li
                      key={stop.id}
                      data-stop-id={stop.id}
                      className="border-border flex flex-wrap items-center gap-2 rounded-(--radius-control) border p-2"
                    >
                      <span className="text-ink min-w-0 flex-1 basis-40 text-sm font-medium">
                        {stop.url ? (
                          <a
                            href={stop.url}
                            target="_blank"
                            rel={PLACE_LINK_REL}
                            className="underline-offset-4 hover:underline"
                          >
                            {stop.title}
                            <span className="sr-only"> (opens in a new tab)</span>
                          </a>
                        ) : (
                          stop.title
                        )}
                      </span>
                      <div className="flex flex-wrap gap-1">
                        {MOVES.map((entry) => (
                          <button
                            key={entry.direction}
                            type="button"
                            data-move={entry.direction}
                            aria-disabled={blocked(entry.direction) || pending || undefined}
                            aria-label={`Move ${stop.title} ${entry.label}`}
                            onClick={() => {
                              if (blocked(entry.direction) || pending) return;
                              move(stop.id, entry.direction, stop.title);
                            }}
                            className={ICON_BUTTON}
                          >
                            <Icon name={entry.icon} size={1} aria-hidden="true" />
                          </button>
                        ))}
                        <button
                          type="button"
                          aria-disabled={pending || undefined}
                          onClick={() => {
                            if (pending) return;
                            apply(
                              () => removeDayStopAction({ tripId: view.tripId, itemId: stop.id }),
                              `Removed ${stop.title}. Saved.`,
                            );
                          }}
                          className={`${ICON_BUTTON} w-auto px-3 text-sm`}
                        >
                          Remove<span className="sr-only"> {stop.title}</span>
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ol>
            )}
          </section>
        ))}
      </div>

      <div className="flex flex-col gap-3">
        <h4 className="text-ink text-base font-medium">Add a stop</h4>
        <Select
          label="To which day"
          value={addDay}
          onChange={(event) => setAddDay(event.target.value)}
          options={dayOptions}
        />
        <div className="flex flex-wrap items-end gap-3">
          <Select
            label="A place from the list"
            value={placeId}
            onChange={(event) => setPlaceId(event.target.value)}
            options={[
              { value: '', label: 'Choose a place' },
              ...things.map((thing) => ({ value: thing.id, label: thing.name })),
            ]}
          />
          <Button
            type="button"
            variant="secondary"
            size="md"
            disabled={pending || !chosen}
            onClick={() =>
              chosen &&
              add({ title: chosen.name, url: chosen.wikipediaUrl ?? null }, () => setPlaceId(''))
            }
          >
            Add place
          </Button>
        </div>
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            const title = typed.trim();
            if (title !== '') add({ title, url: null }, () => setTyped(''));
          }}
        >
          <Field
            label="A stop of your own"
            value={typed}
            maxLength={140}
            onChange={(event) => setTyped(event.target.value)}
            hint="A cafe, a viewpoint, a rest. Anything you type is kept as written."
          />
          <Button
            type="submit"
            variant="secondary"
            size="md"
            disabled={pending || typed.trim() === ''}
          >
            Add stop
          </Button>
        </form>
      </div>
    </div>
  );
}
