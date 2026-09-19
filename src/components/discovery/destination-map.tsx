import { format } from '@/core/money';
import { Card, CardTitle, Tag } from '@/components/ui';
import { buildMapPoints, MAP_MODES, MAP_MODE_LABELS, type MapMode } from '@/discovery/map-model';
import { resolveDestinationGeo } from '@/search/destination-names';
import type { SearchOutcome } from '@/search/types';
import { DestinationGlobe } from './destination-globe';

/**
 * Where you can go (1.10.1 sections 11 to 14).
 *
 * The globe is the decoration and this list is the content. That ordering is
 * deliberate and it is what makes shipping a canvas defensible: every
 * destination on the map is a link here, in the same order, with the same
 * figures and the same reason, so the answer to "where can I go?" survives no
 * JavaScript, a screen reader, a text browser and a WebGL failure.
 *
 * Section 14 says not to hide the optimisation logic. Switching mode reorders
 * both the list and the map, and each destination states why it sits where it
 * does - quoting a figure the engines produced, never one worded into
 * existence here.
 *
 * Selecting a destination narrows the results that are already on the page. It
 * does not run another search, for the same reason the filters do not: a
 * search is dozens of billed provider calls, and the trips are already priced.
 */

export interface DestinationMapProps {
  outcome: SearchOutcome;
  mode: MapMode;
  /** The current query, so mode and destination links keep the search. */
  searchValues: Readonly<Record<string, string | undefined>>;
  /** The destination currently narrowed to, if any. */
  selected: string | null;
}

function href(
  searchValues: Readonly<Record<string, string | undefined>>,
  overrides: Readonly<Record<string, string | null>>,
): string {
  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(searchValues)) {
    if (typeof value === 'string' && value !== '' && !(key in overrides)) params.set(key, value);
  }

  for (const [key, value] of Object.entries(overrides)) {
    if (value !== null) params.set(key, value);
  }

  return `/?${params.toString()}`;
}

export function DestinationMap({ outcome, mode, searchValues, selected }: DestinationMapProps) {
  const points = buildMapPoints({ outcome, mode, geo: resolveDestinationGeo });

  // One destination is not a discovery surface; it is the search the user
  // already ran.
  if (points.length < 2) return null;

  const labels = Object.fromEntries(
    points.map((point) => [
      point.destination,
      point.cheapestTotal ? `From ${format(point.cheapestTotal)}` : 'Nothing found',
    ]),
  );

  const placed = points.length;
  const found = new Set(outcome.results.map((trip) => trip.candidate.destination)).size;

  return (
    <Card as="section" aria-labelledby="map-heading" elevation="raised" feature>
      <CardTitle id="map-heading" level={2} display>
        Where you can go
      </CardTitle>
      <p className="text-ink-muted mt-1 text-sm">
        The {placed} destinations this search found trips for, ranked by what you care about.
      </p>

      <fieldset className="mt-4 flex flex-col gap-2">
        <legend className="text-ink text-sm font-medium">Rank them by</legend>
        <div className="flex flex-wrap gap-2">
          {MAP_MODES.map((option) => (
            // Links rather than radios, because choosing one navigates: the
            // ranking is in the URL, so it is shareable and the back button
            // undoes it, exactly like every other control on this page.
            <a
              key={option}
              href={href(searchValues, { mapMode: option })}
              aria-current={option === mode ? 'true' : undefined}
              className={[
                'border-border bg-surface-raised text-ink rounded-[--radius-pill] border px-3 py-1.5 text-sm',
                'ease-standard duration-quick hover:bg-surface-sunken transition-colors',
                'focus-visible:outline-brand-500 focus-visible:outline-2 focus-visible:outline-offset-2',
                option === mode
                  ? 'border-brand-500 bg-brand-500/10 text-brand-ink font-medium'
                  : '',
              ].join(' ')}
            >
              {MAP_MODE_LABELS[option]}
            </a>
          ))}
        </div>
      </fieldset>

      <div className="mt-4 grid gap-4 lg:grid-cols-[3fr_2fr]">
        <DestinationGlobe points={points} mode={mode} labels={labels} />

        <ol className="flex flex-col gap-2">
          {points.map((point) => {
            const isSelected = selected === point.destination;

            return (
              <li key={point.destination}>
                <a
                  id={`destination-${point.destination}`}
                  href={href(searchValues, { fDest: isSelected ? null : point.destination })}
                  aria-current={isSelected ? 'true' : undefined}
                  className={[
                    'border-border bg-surface-raised block rounded-[--radius-card] border p-3',
                    'ease-standard duration-quick hover:bg-surface-sunken transition-colors',
                    'focus-visible:outline-brand-500 focus-visible:outline-2 focus-visible:outline-offset-2',
                    isSelected ? 'border-brand-500 bg-brand-500/5' : '',
                  ].join(' ')}
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                    <span className="text-ink text-sm font-medium">
                      {point.name}
                      <span className="text-ink-muted font-normal"> · {point.country}</span>
                    </span>
                    <span className="text-ink text-sm font-semibold tabular-nums">
                      {labels[point.destination]}
                    </span>
                  </div>
                  {/* Section 14: explain why a destination appears. */}
                  <p className="text-ink-muted mt-1 text-sm">{point.reason}</p>
                </a>
              </li>
            );
          })}
        </ol>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {selected ? (
          <a
            href={href(searchValues, { fDest: null })}
            className="text-brand-ink text-sm underline underline-offset-4"
          >
            Show every destination
          </a>
        ) : null}
        {placed < found ? (
          <Tag tone="neutral">{found - placed} more found, but we do not know where they are</Tag>
        ) : null}
      </div>

      {/*
        Sections 13 and 14 list more than this can answer. Naming the gap beats
        a control that silently matches everything: a transport filter offering
        "train" that quietly returns flights is worse than no filter at all.
      */}
      <p className="text-ink-muted mt-4 text-sm">
        Flights only for now - trains, buses, ferries and driving need providers this product does
        not have yet, and so do the seasonal and &ldquo;most interesting&rdquo; rankings. The globe
        shows where we can actually price a trip.
      </p>
    </Card>
  );
}
