'use client';

import { useEffect, useRef, useState } from 'react';
import { format, money } from '@/core/money';
import { Skeleton } from '@/components/ui';
import type { RecommendationView } from '@/search/recommendations';

/**
 * The recommendation list: what is stored now, replaced when a refresh lands.
 *
 * The stored list is on screen at once. If it needs refreshing (`view.status !== 'fresh'`), `refresh`
 * runs once in the background; nothing here decides whether the MCP is called, the server does.
 * The list box has a fixed minimum height of `ROW_COUNT` rows, and while a refresh runs the rows
 * that are not yet known are skeletons of the same height, so the page below does not move when
 * the answer arrives. Prices are formatted from integer minor units; no arithmetic happens here.
 */

export const RECOMMENDATION_ROW_COUNT = 5;
const ROW_HEIGHT_REM = 3.5;

export interface RecommendationsListProps {
  initial: RecommendationView;
  /** Asks the server to refresh; it makes an MCP call only if the stored list is old. */
  refresh: () => Promise<RecommendationView>;
  /** `IATA code -> name`, when known. */
  names?: Readonly<Record<string, string>>;
}

export function RecommendationsList({ initial, refresh, names }: RecommendationsListProps) {
  const [view, setView] = useState(initial);
  const [refreshing, setRefreshing] = useState(initial.status !== 'fresh');
  const started = useRef(false);

  useEffect(() => {
    if (started.current || initial.status === 'fresh') return;
    started.current = true;
    let live = true;
    refresh()
      .then((next) => {
        if (live) setView(next);
      })
      .catch(() => undefined)
      .finally(() => {
        if (live) setRefreshing(false);
      });
    return () => {
      live = false;
    };
  }, [initial.status, refresh]);

  const rows = view.items.slice(0, RECOMMENDATION_ROW_COUNT);
  const placeholders =
    refreshing || view.status === 'missing' ? RECOMMENDATION_ROW_COUNT - rows.length : 0;
  const note = refreshing
    ? view.status === 'missing'
      ? 'Looking for trips'
      : `Showing the last list, ${view.label}. Updating`
    : view.refreshFailed
      ? `Could not refresh. Showing the list ${view.label}`
      : view.status === 'missing'
        ? 'No recommendations yet'
        : view.label;

  return (
    <section aria-labelledby="recommendations-heading" aria-busy={refreshing}>
      <h2 id="recommendations-heading" className="text-lg font-semibold">
        Recommended trips
      </h2>
      <p role="status" className="text-ink-muted text-sm">
        {note}
      </p>
      <ul
        className="mt-3 flex flex-col gap-2"
        style={{ minHeight: `${RECOMMENDATION_ROW_COUNT * ROW_HEIGHT_REM}rem` }}
      >
        {rows.map((item) => (
          <li
            key={item.destination}
            className="border-border flex items-center justify-between rounded-(--radius-card) border px-4"
            style={{ height: `${ROW_HEIGHT_REM - 0.5}rem` }}
          >
            <span>{names?.[item.destination] ?? item.destination}</span>
            <span className="tabular-nums">{format(money(item.priceMinor, item.currency))}</span>
          </li>
        ))}
        {Array.from({ length: placeholders }, (_, index) => (
          <li
            key={`placeholder-${index}`}
            aria-hidden="true"
            style={{ height: `${ROW_HEIGHT_REM - 0.5}rem` }}
          >
            <Skeleton className="h-full w-full rounded-(--radius-card)" />
          </li>
        ))}
      </ul>
    </section>
  );
}
