import * as React from 'react';
import Link from 'next/link';
import { Icon, Skeleton, type IconName } from '@/components/ui';
import { AddToPlan, type PlanTrip } from '@/components/search/add-to-plan';
import { formatKilometres } from '@/core/distance';
import {
  KIND_LABELS,
  MAX_THINGS_SHOWN,
  countsByKind,
  placesToShow,
  type ThingsToDoOutcome,
} from '@/discovery/things-to-do';
import { placeImageUrl } from '@/providers/places/image-url';
import { THING_KINDS, type ThingKind, type ThingToDo } from '@/providers/types';
import type { Tint } from '@/lib/tint';

/**
 * "Things to do in {city}": real places, grouped by kind.
 *
 * Every place is an entry in an open dataset and every figure on a card is that
 * entry's own: its name, its one-line description, how far it is from the
 * centre. There are no stars and no scores, because the source has none, and a
 * number we made up to fill the slot would be the one thing worth not shipping.
 *
 * **A place without a photograph gets a plain tile with the mark of its kind.**
 * Never a generated picture standing in for the real one.
 *
 * The filter row is made of links (`?kind=`), so it works without JavaScript and
 * a filtered view can be shared; the current one carries `aria-current`.
 */

const KIND_ICON: Record<ThingKind, IconName> = {
  sights: 'pin',
  museums: 'sparkle',
  outdoors: 'sun',
  neighbourhoods: 'map',
  food: 'utensils',
  culture: 'star',
};

const KIND_TINT: Record<ThingKind, Tint> = {
  sights: 'harbour',
  museums: 'leather',
  outdoors: 'sage',
  neighbourhoods: 'sand',
  food: 'clay',
  culture: 'harbour',
};

/** "mosque in Turkey" starts a card; the source writes it as a phrase. */
function sentenceCase(text: string): string {
  return text.charAt(0).toLocaleUpperCase('en') + text.slice(1);
}

export interface ThingsToDoSectionProps {
  outcome: ThingsToDoOutcome;
  city: string;
  /** The page's own address for a filter, with every other parameter carried over. */
  hrefFor: (kind: ThingKind | null) => string;
  /** The filter in force, or null for all. */
  kind: ThingKind | null;
  /** The signed-in person's trips; null hides "Add to my plan". */
  planTrips?: readonly PlanTrip[] | null;
}

function PlaceCard({
  place,
  planTrips,
}: {
  place: ThingToDo;
  planTrips: readonly PlanTrip[] | null;
}) {
  const label = KIND_LABELS[place.kind];

  return (
    <li
      data-tint={KIND_TINT[place.kind]}
      className="border-border bg-surface-raised flex min-w-0 flex-col overflow-hidden rounded-(--radius-card) border"
    >
      <div className="bg-surface-sunken relative aspect-[4/3] overflow-hidden">
        {place.imageFile ? (
          // The name is the heading directly below, so the picture adds nothing a
          // screen reader needs; the photographer is named in the credits.
          // eslint-disable-next-line @next/next/no-img-element -- our own proxy route, sized by width
          <img
            src={placeImageUrl(place.imageFile, 640)}
            srcSet={`${placeImageUrl(place.imageFile, 320)} 320w, ${placeImageUrl(place.imageFile, 640)} 640w`}
            sizes="(min-width: 1280px) 16rem, (min-width: 640px) 45vw, 90vw"
            alt=""
            width={640}
            height={480}
            loading="lazy"
            decoding="async"
            className="absolute inset-0 size-full object-cover"
          />
        ) : (
          <span
            aria-hidden="true"
            className="text-tint-ink grid size-full place-items-center opacity-80"
          >
            <Icon name={KIND_ICON[place.kind]} size={2.5} />
          </span>
        )}
      </div>

      <div className="flex flex-1 flex-col gap-2 p-4">
        <p className="text-dim text-[11px] font-medium tracking-[0.18em] uppercase">{label}</p>
        <h3 className="font-display text-ink text-[1.125rem] leading-snug">{place.name}</h3>
        {place.description ? (
          <p className="text-ink-muted line-clamp-2 text-sm">{sentenceCase(place.description)}</p>
        ) : null}
        <p className="text-ink-muted text-sm tabular-nums">
          {formatKilometres(place.distanceFromCentreMetres)} from the centre
        </p>

        <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1 pt-1">
          {place.wikipediaUrl ? (
            <a
              href={place.wikipediaUrl}
              target="_blank"
              rel="noopener"
              className="text-tint-ink inline-flex min-h-11 items-center text-sm underline underline-offset-4"
            >
              Read more{' '}
              <span className="sr-only">about {place.name} on Wikipedia (opens in a new tab)</span>
            </a>
          ) : null}
          {planTrips ? (
            <AddToPlan
              place={{ title: place.name, url: place.wikipediaUrl }}
              subject={place.name}
              trips={planTrips}
            />
          ) : null}
        </div>
      </div>
    </li>
  );
}

export function ThingsToDoSection({
  outcome,
  city,
  hrefFor,
  kind,
  planTrips = null,
}: ThingsToDoSectionProps) {
  if (outcome.status !== 'ok' || outcome.things.length === 0) return null;

  const counts = countsByKind(outcome.things);
  // A filter for a group with nothing in it (a stale link) shows everything.
  const active = kind !== null && counts[kind] > 0 ? kind : null;
  const shown = placesToShow(outcome.things, active);
  const pictured = shown.filter((place) => place.imageFile !== null);

  return (
    <section aria-labelledby="things-heading" className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h2 id="things-heading" className="font-display text-display-sm text-ink">
          Things to do in {city}
        </h2>
        <p className="text-ink-muted text-sm tabular-nums">
          {shown.length} {shown.length === 1 ? 'place' : 'places'}
          {outcome.sample ? ' - samples for demonstration, not real places' : null}
        </p>
      </div>

      <nav aria-label="Filter things to do by kind">
        <ul className="flex flex-wrap gap-2">
          {[null, ...THING_KINDS.filter((group) => counts[group] > 0)].map((group) => {
            const current = group === active;

            return (
              <li key={group ?? 'all'}>
                <Link
                  href={hrefFor(group)}
                  scroll={false}
                  aria-current={current ? 'true' : undefined}
                  className={
                    current
                      ? 'bg-ink text-surface inline-flex min-h-11 items-center rounded-full px-4 text-sm font-medium'
                      : 'border-border text-ink hover:bg-surface-sunken inline-flex min-h-11 items-center rounded-full border px-4 text-sm'
                  }
                >
                  {group === null ? 'All' : KIND_LABELS[group]}
                  {group !== null ? (
                    <span className="ml-1.5 tabular-nums opacity-70">
                      {Math.min(counts[group], MAX_THINGS_SHOWN)}
                    </span>
                  ) : null}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {shown.map((place) => (
          <PlaceCard key={place.id} place={place} planTrips={planTrips} />
        ))}
      </ul>

      <p className="text-dim text-xs">
        Places from Wikidata (CC0); photographs from Wikimedia Commons, credited below.
      </p>

      {pictured.length > 0 ? (
        <details className="text-ink-muted text-sm">
          <summary className="text-ink min-h-11 w-fit cursor-pointer py-2 text-sm font-medium">
            Photograph credits
          </summary>
          <ul className="mt-2 flex flex-col gap-1.5">
            {pictured.map((place) => {
              const file = place.imageFile as string;
              const credit = outcome.credits[file];

              return (
                <li key={place.id}>
                  <span className="text-ink">{place.name}</span>:{' '}
                  {credit?.author ?? 'author not stated'}, {credit?.licence ?? 'licence not stated'}
                  .{' '}
                  <a
                    href={
                      credit?.pageUrl ??
                      `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(file)}`
                    }
                    target="_blank"
                    rel="noopener"
                    className="text-tint-ink underline underline-offset-4"
                  >
                    File page <span className="sr-only">for {place.name} (opens in a new tab)</span>
                  </a>
                </li>
              );
            })}
          </ul>
        </details>
      ) : null}
    </section>
  );
}

/** What stands in while the source answers, which can take many seconds the first time. */
export function ThingsToDoSkeleton({ city }: { city: string }) {
  return (
    <section aria-labelledby="things-heading" aria-busy="true" className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h2 id="things-heading" className="font-display text-display-sm text-ink">
          Things to do in {city}
        </h2>
        <Skeleton label="Loading things to do" className="h-5 w-40" />
      </div>
      <ul aria-hidden="true" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {[0, 1, 2].map((slot) => (
          <li
            key={slot}
            className="border-border bg-surface-raised overflow-hidden rounded-(--radius-card) border"
          >
            <Skeleton className="aspect-[4/3] w-full rounded-none" />
            <div className="flex flex-col gap-2 p-4">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-5 w-3/4" />
              <Skeleton className="h-4 w-full" />
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Awaits the load the page started, so the rest of the page is not held for it. */
export async function ThingsToDoLoaded({
  outcome,
  ...rest
}: Omit<ThingsToDoSectionProps, 'outcome'> & { outcome: Promise<ThingsToDoOutcome> }) {
  return <ThingsToDoSection {...rest} outcome={await outcome} />;
}
