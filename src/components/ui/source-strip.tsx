import * as React from 'react';
import { cn } from '@/lib/cn';
import {
  PROVENANCE_EMPHASIS,
  PROVENANCE_EXPLANATION,
  PROVENANCE_LABEL,
  type SourceAttribution,
} from '@/core/trip/provenance';

/**
 * Who supplied each part of a result, named on the result itself.
 *
 * The combined provenance badge answers "is this total real?" and takes the
 * weakest claim, which is right - a trip cannot be half-bookable. It is also
 * not the question somebody debugging an integration is asking, which is
 * *which* part is real. A search running live flights against demo hotels
 * reads as "Demo data" and gives no hint that the flights came from anywhere
 * at all.
 *
 * So this names the provider beside its own provenance: `DUFFEL Test data`,
 * `AVIASALES Recently checked`, `DEMO Demo data`. It is rendered wherever a
 * price is, not only in a log.
 *
 * **The label is never chosen here.** It comes from `PROVENANCE_LABEL`, which
 * is derived from how the adapter actually ran - so nothing can be called
 * "Live price" by a component deciding it looks nicer.
 */

export interface SourceStripProps extends React.HTMLAttributes<HTMLUListElement> {
  readonly sources: readonly SourceAttribution[];
  /** `full` names the provider; `compact` shows only the provider's name. */
  readonly detail?: 'full' | 'compact';
}

/**
 * One provider's tag, for the line it actually supplied.
 *
 * The strip answers "what went into this trip"; this answers "where did this
 * number come from", which is the question being asked while looking at one
 * price rather than at a card.
 */
export function SourceTag({
  source,
  className,
  ...props
}: { readonly source: SourceAttribution } & React.HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={cn(
        'voyagr-source',
        PROVENANCE_EMPHASIS[source.provenance] === 'intrusive' && 'voyagr-source-loud',
        className,
      )}
      title={PROVENANCE_EXPLANATION[source.provenance]}
      {...props}
    >
      <span className="voyagr-source-name">
        {providerLabel(source)} {PART_LABEL[source.part]}
      </span>
      <span className="sr-only">Data source: </span>
      {PROVENANCE_LABEL[source.provenance]}
    </span>
  );
}

/** The provider's own name, upper-cased for a tag. `DEMO` for a fixture. */
function providerLabel(source: SourceAttribution): string {
  return source.provenance === 'mock' ? 'DEMO' : source.displayName.toUpperCase();
}

/**
 * What this provider supplied, in one word.
 *
 * Named alongside the provider so a tag reads `DUFFEL FLIGHT` or
 * `DEMO HOTEL`. Three tags saying only `DEMO` tell you a search was mocked;
 * they do not tell you *which part* was, which is the thing worth knowing
 * when flights are real and hotels are not.
 */
const PART_LABEL: Record<SourceAttribution['part'], string> = {
  flights: 'Flight',
  hotels: 'Hotel',
  stays: 'Stay',
  transfers: 'Transfer',
};

export function SourceStrip({ sources, detail = 'full', className, ...props }: SourceStripProps) {
  if (sources.length === 0) return null;

  /*
   * One entry per part, keyed by provider too.
   *
   * A trip whose flights are real and whose hotel is a fixture has to say
   * both, and saying `DEMO` twice without naming what is demo is the thing
   * this component exists to stop.
   */
  const unique = new Map<string, SourceAttribution>();
  for (const source of sources) {
    unique.set(`${source.part}:${source.providerId}:${source.provenance}`, source);
  }

  return (
    <ul className={cn('flex flex-wrap items-center gap-1.5', className)} {...props}>
      {[...unique.values()].map((source) => (
        <li key={`${source.providerId}:${source.provenance}`}>
          <span
            className={cn(
              'voyagr-source',
              PROVENANCE_EMPHASIS[source.provenance] === 'intrusive' && 'voyagr-source-loud',
            )}
            title={PROVENANCE_EXPLANATION[source.provenance]}
          >
            {detail === 'full' ? (
              <span className="voyagr-source-name">
                {providerLabel(source)} {PART_LABEL[source.part]}
              </span>
            ) : null}
            <span className="sr-only">Data source: </span>
            {PROVENANCE_LABEL[source.provenance]}
          </span>
        </li>
      ))}
    </ul>
  );
}
