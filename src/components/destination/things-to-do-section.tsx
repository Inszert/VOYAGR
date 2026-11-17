import { Skeleton } from '@/components/ui';
import { MAX_THINGS_SHOWN, countsByKind, type ThingsToDoOutcome } from '@/discovery/things-to-do';
import { THING_KINDS, type ThingKind } from '@/providers/types';
import { ThingsExplorer } from './things-explorer';
import type { TripStyle } from './style-order';
import './destination.css';

/**
 * "Things to do in {city}": real places, grouped by kind.
 *
 * Every place is an entry in an open dataset and every figure on a card is that
 * entry's own: its name, its one-line description, how far it is from the
 * centre. There are no stars and no scores, because the source has none, and a
 * number we made up to fill the slot would be the one thing worth not shipping.
 *
 * **A card has a photograph or it is not a card.** Places without one are a
 * compact "More places" list beneath. Never a generated picture standing in
 * for the real one.
 *
 * This is the server half: the heading and the work of turning the page's
 * addresses into one link per filter. The picture of where things are, the
 * filter and the cards are `ThingsExplorer`, which reads the places from the
 * shared `PlacesProvider` so the plan below and the sheet agree with it.
 */

export interface ThingsToDoSectionProps {
  outcome: ThingsToDoOutcome;
  city: string;
  /** The page's own address for a filter, with every other parameter carried over. */
  hrefFor: (kind: ThingKind | null) => string;
  /** The filter in force, or null for all. */
  kind: ThingKind | null;
  /** The trip style in force (`?style=`), or null for the current order. */
  style?: TripStyle | null;
}

export function ThingsToDoSection({
  outcome,
  city,
  hrefFor,
  kind,
  style = null,
}: ThingsToDoSectionProps) {
  if (outcome.status !== 'ok' || outcome.things.length === 0) return null;

  const counts = countsByKind(outcome.things);
  // A filter for a group with nothing in it (a stale link) shows everything.
  const active = kind !== null && counts[kind] > 0 ? kind : null;
  const hrefs: Record<string, string> = { all: hrefFor(null) };
  for (const group of THING_KINDS) hrefs[group] = hrefFor(group);

  return (
    <section
      id="things"
      aria-labelledby="things-heading"
      className="voyagr-anchor flex flex-col gap-5"
    >
      <div className="flex flex-col gap-1">
        <p className="text-dim text-[11px] font-medium tracking-[0.18em] uppercase">What to see</p>
        <h2 id="things-heading" className="font-display text-display-sm text-ink">
          Things to do in {city}
        </h2>
      </div>

      <ThingsExplorer
        hrefs={hrefs}
        counts={counts}
        initialKind={active}
        initialStyle={style}
        max={MAX_THINGS_SHOWN}
        sample={outcome.sample}
      />
    </section>
  );
}

/** What stands in while the source answers, which can take many seconds the first time. */
export function ThingsToDoSkeleton({ city }: { city: string }) {
  return (
    <section
      id="things"
      aria-labelledby="things-heading"
      aria-busy="true"
      className="voyagr-anchor flex flex-col gap-5"
    >
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
