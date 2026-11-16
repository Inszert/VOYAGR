'use client';

import * as React from 'react';
import { RemotePicture } from '@/components/home/remote-picture';
import { Icon, Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui';
import { formatKilometres } from '@/core/distance';
import type { FirstPlan, PlanDay, PlanStop } from '@/discovery/first-plan';
import { placeImageUrl } from '@/providers/places/image-url';
import { cn } from '@/lib/cn';
import { AddPlacesToPlan } from './add-places-to-plan';
import { KIND_ICON, KIND_TINT, KIND_WORDS } from './place-kinds';
import { usePlaces } from './places-context';
import { useReducedMotion as useReducedMotionOrNull } from './use-media';
import './destination.css';

/**
 * "A first plan for N nights": days as tabs, each a three-stop timeline.
 *
 * Every stop is one of the places in "Things to do" - drawn from that list and
 * nowhere else - and opens the same detail sheet. The order is a
 * nearest-neighbour walk (see `src/discovery/first-plan.ts`) and the distance
 * under a stop is the straight line from the one before, said as that. Words
 * only describe; nothing here is a booking or an opening time.
 */

const SLOT_WORDS = { morning: 'Morning', afternoon: 'Afternoon', evening: 'Evening' } as const;
const FADE_OUT_MS = 150;

function Thumbnail({ stop }: { stop: PlanStop }) {
  const { place } = stop;

  return (
    <span
      data-tint={KIND_TINT[place.kind]}
      className="bg-surface-sunken text-tint-ink relative grid size-14 shrink-0 place-items-center overflow-hidden rounded-(--radius-control)"
    >
      {/* The kind's mark is always there; a photograph covers it once it has arrived. */}
      <Icon name={KIND_ICON[place.kind]} size={1.4} aria-hidden="true" />
      {place.imageFile ? (
        <RemotePicture
          src={placeImageUrl(place.imageFile, 320)}
          alt=""
          width={56}
          height={56}
          fallback={null}
          className="absolute inset-0 size-full object-cover"
        />
      ) : null}
    </span>
  );
}

function Timeline({ day }: { day: PlanDay }) {
  const { open } = usePlaces();
  const [rain, setRain] = React.useState(false);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h3 className="font-display text-ink text-xl">{day.title}</h3>
        {day.rainLikely ? (
          <p className="text-ink-muted flex items-center gap-1.5 text-sm">
            <Icon name="drop" size={0.9} className="text-temp-cool" aria-hidden="true" />
            Rain is likely this day
          </p>
        ) : null}
      </div>

      <ol className="relative flex flex-col">
        {day.stops.map((stop, position) => (
          <li key={stop.place.id} className="relative flex gap-4 pb-6 last:pb-0">
            {/* The line that joins the stops, drawn behind the thumbnails. */}
            {position < day.stops.length - 1 ? (
              <span
                aria-hidden="true"
                className="bg-border-strong absolute top-14 bottom-0 left-7 w-px -translate-x-1/2"
              />
            ) : null}
            <Thumbnail stop={stop} />
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <p className="text-dim text-[11px] font-medium tracking-[0.18em] uppercase">
                {SLOT_WORDS[stop.slot]} <span aria-hidden="true">·</span>{' '}
                <span className="sr-only">, </span>
                {KIND_WORDS[stop.place.kind]}
              </p>
              <button
                type="button"
                onClick={() => open(stop.place.id)}
                className="text-ink min-h-11 w-fit text-left text-base font-medium underline-offset-4 hover:underline sm:min-h-0 sm:py-0.5"
              >
                {stop.place.name}
                <span className="sr-only"> - details</span>
              </button>
              <p className="text-ink-muted text-sm">{stop.line}</p>
              {stop.metresFromPrevious !== null ? (
                <p className="text-dim flex items-center gap-1.5 text-xs tabular-nums">
                  <Icon name="pin" size={0.85} aria-hidden="true" />
                  {formatKilometres(stop.metresFromPrevious)} from the stop before, in a straight
                  line
                </p>
              ) : null}
            </div>
          </li>
        ))}
      </ol>

      {day.ifItRains ? (
        <div className="flex flex-col gap-2">
          <button
            type="button"
            aria-expanded={rain}
            onClick={() => setRain((value) => !value)}
            className="border-border text-ink hover:bg-surface-sunken ease-standard duration-quick inline-flex min-h-11 w-fit items-center gap-2 rounded-full border px-4 text-sm active:scale-[0.97] motion-reduce:active:scale-100"
          >
            <Icon name="cloud" size={1} aria-hidden="true" />
            If it rains
          </button>
          {rain ? (
            <p className="text-ink-muted max-w-xl text-sm">
              Swap {day.ifItRains.replaces.name} for{' '}
              <button
                type="button"
                onClick={() => open(day.ifItRains!.place.id)}
                className="text-tint-ink underline underline-offset-4"
              >
                {day.ifItRains.place.name}
              </button>
              , which is indoors ({KIND_WORDS[day.ifItRains.place.kind].toLowerCase()}),{' '}
              {formatKilometres(day.ifItRains.place.distanceFromCentreMetres)} from the centre.
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function FirstPlanSection({
  plan,
  sample,
}: {
  plan: FirstPlan;
  /** True when no dates were given and the length is only an example. */
  sample: boolean;
}) {
  const { planTrips } = usePlaces();
  const reduced = useReducedMotionOrNull() === true;
  const [value, setValue] = React.useState('1');
  const [fading, setFading] = React.useState(false);
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  React.useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  const index = Math.max(
    0,
    plan.days.findIndex((day) => String(day.dayNumber) === value),
  );
  const day = plan.days[index]!;
  const covered = plan.days.length;

  const change = (next: string) => {
    if (next === value) return;
    if (reduced) {
      setValue(next);
      return;
    }
    setFading(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      setValue(next);
      setFading(false);
    }, FADE_OUT_MS);
  };

  const dayPlaces = (target: PlanDay) =>
    target.stops.map((stop) => ({ title: stop.place.name, url: stop.place.wikipediaUrl }));

  return (
    <section
      id="plan"
      aria-labelledby="itinerary-heading"
      className="voyagr-anchor flex flex-col gap-5"
    >
      <div className="flex flex-col gap-1">
        <p className="text-dim text-[11px] font-medium tracking-[0.18em] uppercase">Day by day</p>
        <h2 id="itinerary-heading" className="font-display text-display-sm text-ink">
          A first plan for {plan.nights} {plan.nights === 1 ? 'night' : 'nights'}
        </h2>
        <p className="text-ink-muted max-w-2xl text-sm">
          {covered} {covered === 1 ? 'day' : 'days'} of the places listed above, grouped by how
          close they are
          {covered < plan.nights ? `; there are not enough places to fill all ${plan.nights}` : ''}
          {sample ? ', for an example length of stay' : ''}. A starting point to change, not a
          booking: check opening times before you go.
        </p>
      </div>

      <Tabs value={String(day.dayNumber)} onValueChange={change} activationMode="automatic">
        <div className="voyagr-strip">
          <TabsList
            aria-label="Days of the plan"
            className="relative inline-flex min-w-full border-b-0"
          >
            <span
              aria-hidden="true"
              className="bg-border-strong absolute inset-x-0 bottom-0 h-px"
            />
            <span
              aria-hidden="true"
              className="bg-brand-ink voyagr-secbar-line absolute bottom-0 left-0 h-px"
              style={{ width: `${((index + 1) / covered) * 100}%` }}
            />
            {plan.days.map((entry) => (
              <TabsTrigger
                key={entry.dayNumber}
                value={String(entry.dayNumber)}
                className="min-w-28 flex-1 justify-center border-b-0 px-3 tabular-nums data-[state=active]:font-semibold"
              >
                Day {entry.dayNumber}
                {entry.weekday ? (
                  <>
                    <span aria-hidden="true"> · </span>
                    <span className="sr-only">, </span>
                    {entry.weekday}
                  </>
                ) : null}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>

        {plan.days.map((entry) => (
          <TabsContent
            key={entry.dayNumber}
            value={String(entry.dayNumber)}
            className={cn(
              'voyagr-plan-day pt-6 transition-opacity duration-150',
              fading ? 'opacity-0' : 'opacity-100',
            )}
            data-fresh="true"
          >
            <Timeline day={entry} />
          </TabsContent>
        ))}
      </Tabs>

      {planTrips ? (
        <div className="border-border flex flex-wrap gap-x-4 gap-y-1 border-t pt-3">
          <AddPlacesToPlan
            places={dayPlaces(day)}
            trips={planTrips}
            label="Add this day to my plan"
          />
          <AddPlacesToPlan
            places={plan.days.flatMap(dayPlaces)}
            trips={planTrips}
            label="Add the whole plan"
          />
        </div>
      ) : null}
    </section>
  );
}
