'use client';

import { useActionState } from 'react';
import Link from 'next/link';
import { format, toMajor } from '@/core/money';
import { Badge, Button, Card, type BadgeTone } from '@/components/ui';
import type { WatchFormState } from '@/app/actions/watches';
import type { TravelWatchRecord, TripSearchRecord } from '@/db/repository';

/**
 * The watches list.
 *
 * Each row answers the two questions a watch exists to answer: is it running,
 * and when will it look again. A watch that cannot say when it next runs is
 * indistinguishable from one that has quietly stopped.
 */

const STATUS_TONE: Record<TravelWatchRecord['status'], BadgeTone> = {
  active: 'positive',
  paused: 'caution',
  archived: 'neutral',
};

const STATUS_LABEL: Record<TravelWatchRecord['status'], string> = {
  active: 'Watching',
  paused: 'Paused',
  archived: 'Archived',
};

export interface WatchRow {
  readonly watch: TravelWatchRecord;
  readonly search: TripSearchRecord;
  /** Resolved by the service, which owns the clock. */
  readonly nextRunLabel: string;
}

export interface WatchListProps {
  rows: readonly WatchRow[];
  pauseAction: (state: WatchFormState, formData: FormData) => Promise<WatchFormState>;
  resumeAction: (state: WatchFormState, formData: FormData) => Promise<WatchFormState>;
  archiveAction: (state: WatchFormState, formData: FormData) => Promise<WatchFormState>;
}

/** Rebuild the query string that reproduces a saved search. */
function searchHref(search: TripSearchRecord): string {
  const { profile } = search;

  return `/?${new URLSearchParams({
    origins: profile.origins.join(', '),
    destinations: search.destinations.join(', '),
    earliestDeparture: profile.earliestDeparture,
    latestReturn: profile.latestReturn,
    minNights: String(profile.minNights),
    maxNights: String(profile.maxNights),
    passengers: String(profile.passengers),
    currency: profile.targetBudget.currency,
    // `toMajor` rather than dividing by 100: not every currency has two
    // decimal places, and the money module is the only thing that knows.
    targetBudget: String(toMajor(profile.targetBudget)),
    maxBudget: String(toMajor(profile.maxBudget)),
    travelStyle: profile.travelStyle,
    optimisationMode: profile.optimisationMode,
  }).toString()}`;
}

function WatchAction({
  action,
  watchId,
  label,
  variant,
}: {
  action: (state: WatchFormState, formData: FormData) => Promise<WatchFormState>;
  watchId: string;
  label: string;
  variant: 'secondary' | 'ghost';
}) {
  const [state, formAction, pending] = useActionState<WatchFormState, FormData>(action, {});

  return (
    <form action={formAction}>
      <input type="hidden" name="watchId" value={watchId} />
      <Button type="submit" size="sm" variant={variant} loading={pending}>
        {label}
      </Button>
      <span role="alert" className="text-critical-500 block text-sm empty:hidden">
        {state.error}
      </span>
    </form>
  );
}

export function WatchList({ rows, pauseAction, resumeAction, archiveAction }: WatchListProps) {
  return (
    <ul className="flex flex-col gap-4">
      {rows.map(({ watch, search, nextRunLabel }) => (
        <li key={watch.id}>
          <Card as="article" aria-labelledby={`watch-${watch.id}`}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 id={`watch-${watch.id}`} className="text-ink text-lg font-semibold">
                  {search.name}
                </h3>
                <p className="text-ink-muted text-sm">
                  {search.destinations.join(', ')} · {search.profile.earliestDeparture} to{' '}
                  {search.profile.latestReturn} · {search.profile.minNights}–
                  {search.profile.maxNights} nights
                </p>
              </div>

              <Badge tone={STATUS_TONE[watch.status]} srPrefix="Status">
                {STATUS_LABEL[watch.status]}
              </Badge>
            </div>

            <dl className="mt-4 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
              <div className="flex justify-between gap-4">
                <dt className="text-ink-muted">Next check</dt>
                <dd className="text-ink">{nextRunLabel}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-ink-muted">Last checked</dt>
                <dd className="text-ink">
                  {watch.lastRunAt ? watch.lastRunAt.slice(0, 16).replace('T', ' ') : 'Not yet'}
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-ink-muted">Best seen so far</dt>
                <dd className="text-ink tabular-nums">
                  {watch.bestKnownTotal ? format(watch.bestKnownTotal) : 'Nothing yet'}
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-ink-muted">Budget ceiling</dt>
                <dd className="text-ink tabular-nums">{format(search.profile.maxBudget)}</dd>
              </div>
            </dl>

            <div className="border-border mt-4 flex flex-wrap items-center gap-3 border-t pt-4">
              {watch.status === 'active' ? (
                <WatchAction
                  action={pauseAction}
                  watchId={watch.id}
                  label="Pause"
                  variant="secondary"
                />
              ) : watch.status === 'paused' ? (
                <WatchAction
                  action={resumeAction}
                  watchId={watch.id}
                  label="Resume"
                  variant="secondary"
                />
              ) : null}

              {watch.status !== 'archived' ? (
                <WatchAction
                  action={archiveAction}
                  watchId={watch.id}
                  label="Archive"
                  variant="ghost"
                />
              ) : null}

              <Link
                href={searchHref(search)}
                className="text-brand-ink text-sm underline underline-offset-4"
              >
                Run this search now
              </Link>
            </div>
          </Card>
        </li>
      ))}
    </ul>
  );
}
