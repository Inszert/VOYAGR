'use client';

import { useActionState, useState } from 'react';
import Link from 'next/link';
import { abs, format } from '@/core/money';
import { Badge, Button, type BadgeTone } from '@/components/ui';
import { searchProfileToQuery } from '@/search/schema';
import type { WatchFormState } from '@/app/actions/watches';
import type { TravelWatchRecord, TripSearchRecord } from '@/db/repository';
import type { PriceTrend } from '@/watches/trend';
import { buySignal, type BuySignalKind } from '@/watches/signal';
import { shortDate } from '@/lib/display-date';

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
  /** Cheapest total on record, with the number of observations behind it. */
  readonly lowestRecorded: TravelWatchRecord['bestKnownTotal'];
  readonly observationCount: number;
  readonly trend: PriceTrend;
}

export interface WatchListProps {
  rows: readonly WatchRow[];
  pauseAction: (state: WatchFormState, formData: FormData) => Promise<WatchFormState>;
  resumeAction: (state: WatchFormState, formData: FormData) => Promise<WatchFormState>;
  archiveAction: (state: WatchFormState, formData: FormData) => Promise<WatchFormState>;
  deleteAction: (state: WatchFormState, formData: FormData) => Promise<WatchFormState>;
  checkAction: (state: WatchFormState, formData: FormData) => Promise<WatchFormState>;
}

/** Rebuild the query string that reproduces a saved search, in full. */
function searchHref(search: TripSearchRecord): string {
  return `/explore?${searchProfileToQuery(search.profile, search.destinations)}`;
}

/**
 * The cheapest trip at each check, as a line.
 *
 * A picture of the figures beside it - the first and the latest are written
 * out, and so is the change - so it is hidden from assistive technology. The
 * line is scaled to its own range; nothing on it is a number anyone reads.
 */
function TrendLine({ trend }: { trend: PriceTrend }) {
  const amounts = trend.points.map((point) => point.lowest.amount);
  const low = Math.min(...amounts);
  const high = Math.max(...amounts);
  const span = high - low || 1;
  const step = 100 / Math.max(1, amounts.length - 1);
  const points = amounts.map(
    (amount, index) => [index * step, 36 - ((amount - low) / span) * 32 - 2] as const,
  );
  const coordinates = points.map(([x, y]) => `${x},${y}`).join(' ');

  return (
    <svg aria-hidden="true" viewBox="-3 -2 106 40" className="text-tint-ink h-14 w-auto">
      <polyline
        points={coordinates}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        vectorEffect="non-scaling-stroke"
        strokeLinejoin="round"
      />
      {/* A mark per check, so the line says how many points it is drawn from. */}
      {points.map(([x, y], index) => (
        <circle key={index} cx={x} cy={y} r="1.6" fill="currentColor" />
      ))}
    </svg>
  );
}

/** What the checks show, in words - an observation, never a forecast. */
const SIGNAL_WORDS: Record<BuySignalKind, { label: string; detail: string }> = {
  lowest: {
    label: 'Lowest seen',
    detail: 'The latest check is the cheapest this watch has found.',
  },
  falling: { label: 'Falling', detail: 'Each of the last three checks came in lower.' },
  rising: { label: 'Rising', detail: 'Each of the last three checks came in higher.' },
  steady: { label: 'Steady', detail: 'No clear direction over the last three checks.' },
};

function TrendSummary({ trend }: { trend: PriceTrend }) {
  if (trend.points.length === 0) {
    return <p className="text-ink-muted text-sm">The trend appears after the first check.</p>;
  }

  if (trend.points.length === 1 || !trend.change) {
    return (
      <p className="text-ink-muted text-sm">
        One check so far, at {format(trend.points[0]!.lowest)}. A trend needs a second.
      </p>
    );
  }

  const first = trend.points[0]!;
  const latest = trend.points[trend.points.length - 1]!;
  const { change } = trend;

  return (
    <div className="flex flex-col gap-2">
      <TrendLine trend={trend} />
      <p className="text-ink-muted text-sm">
        Cheapest trip {format(first.lowest)} on {shortDate(first.observedAt.slice(0, 10))},{' '}
        {format(latest.lowest)} at the latest of {trend.points.length} checks:{' '}
        <span
          className={change.amount < 0 ? 'text-tint-ink font-semibold' : 'text-ink font-semibold'}
        >
          {change.amount === 0
            ? 'no change'
            : `${format(abs(change))} ${change.amount < 0 ? 'less' : 'more'}`}
        </span>
        .
      </p>
      <SignalLine trend={trend} />
    </div>
  );
}

function SignalLine({ trend }: { trend: PriceTrend }) {
  const signal = buySignal(trend);
  if (!signal) return null;

  const words = SIGNAL_WORDS[signal.kind];
  return (
    <p className="flex flex-wrap items-center gap-2 text-sm">
      <Badge
        tone={signal.kind === 'lowest' || signal.kind === 'falling' ? 'positive' : 'neutral'}
        srPrefix="Price signal"
      >
        {words.label}
      </Badge>
      <span className="text-ink-muted">
        {words.detail} From {signal.checks} checks - what has happened, not a forecast.
      </span>
    </p>
  );
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
  variant: 'secondary' | 'ghost' | 'danger';
}) {
  const [state, formAction, pending] = useActionState<WatchFormState, FormData>(action, {});

  return (
    <form action={formAction}>
      <input type="hidden" name="watchId" value={watchId} />
      <Button type="submit" size="sm" variant={variant} loading={pending}>
        {label}
      </Button>
      <span role="alert" className="text-critical-ink block text-sm empty:hidden">
        {state.error}
      </span>
    </form>
  );
}

/**
 * Delete, in two steps.
 *
 * A watch carries weeks of recorded prices and deleting it cannot be undone,
 * so the first press asks and only the second deletes. The question is a
 * real button beside a real cancel, not a browser dialog.
 */
function DeleteWatch({
  action,
  watchId,
  name,
}: {
  action: (state: WatchFormState, formData: FormData) => Promise<WatchFormState>;
  watchId: string;
  name: string;
}) {
  const [asking, setAsking] = useState(false);

  if (!asking) {
    return (
      <Button type="button" size="sm" variant="ghost" onClick={() => setAsking(true)}>
        Delete
      </Button>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label={`Delete ${name}?`}>
      <span className="text-ink text-sm">Delete it and its price history?</span>
      <WatchAction action={action} watchId={watchId} label="Delete for good" variant="danger" />
      <Button type="button" size="sm" variant="ghost" onClick={() => setAsking(false)}>
        Keep it
      </Button>
    </div>
  );
}

export function WatchList({
  rows,
  pauseAction,
  resumeAction,
  archiveAction,
  deleteAction,
  checkAction,
}: WatchListProps) {
  return (
    /*
      A list with rules between its rows, not a stack of cards. Each watch is
      one line of what it is and how it is doing, then its figures, then what
      can be done with it.
    */
    <ul className="divide-border border-border flex flex-col divide-y border-y">
      {rows.map(({ watch, search, nextRunLabel, lowestRecorded, observationCount, trend }) => (
        <li key={watch.id}>
          <article aria-labelledby={`watch-${watch.id}`} className="py-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 id={`watch-${watch.id}`} className="font-display text-ink text-xl">
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

            <dl className="mt-4 grid gap-x-8 gap-y-2 text-sm sm:grid-cols-2 lg:grid-cols-3">
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
                  {lowestRecorded ? format(lowestRecorded) : 'Nothing yet'}
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-ink-muted">Prices recorded</dt>
                {/*
                  Shown because "best seen so far" means nothing without knowing
                  how much looking is behind it. One observation is not a trend.
                */}
                <dd className="text-ink tabular-nums">{observationCount}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-ink-muted">Budget ceiling</dt>
                <dd className="text-ink tabular-nums">{format(search.profile.maxBudget)}</dd>
              </div>
            </dl>

            <div className="mt-4">
              <TrendSummary trend={trend} />
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-3">
              {watch.status === 'active' ? (
                <WatchAction
                  action={checkAction}
                  watchId={watch.id}
                  label="Check now"
                  variant="secondary"
                />
              ) : null}

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
                className="text-tint-ink text-sm underline underline-offset-4"
              >
                Run this search now
              </Link>

              <span className="ml-auto">
                <DeleteWatch action={deleteAction} watchId={watch.id} name={search.name} />
              </span>
            </div>
          </article>
        </li>
      ))}
    </ul>
  );
}
