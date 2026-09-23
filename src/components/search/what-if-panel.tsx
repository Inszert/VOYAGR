import { format, toMajor } from '@/core/money';
import type { BudgetStep } from '@/search/what-if';

/**
 * What a higher ceiling would let in, from trips the search already priced.
 *
 * Every count and every total is from `budgetWhatIf`, which reads the near
 * misses. "Try it" re-runs the search at that ceiling, so what comes back is
 * a fresh answer rather than this estimate of one.
 */
export function WhatIfPanel({
  steps,
  hrefFor,
}: {
  steps: readonly BudgetStep[];
  hrefFor: (ceilingMajor: number) => string;
}) {
  const useful = steps.filter((step) => step.extraTrips > 0);

  return (
    <section aria-labelledby="what-if-heading" className="flex flex-col gap-3">
      <h2 id="what-if-heading" className="font-display text-ink text-xl">
        What if you spent more?
      </h2>

      {useful.length === 0 ? (
        <p className="text-ink-muted text-sm">
          Nothing this search turned away for its price would fit within{' '}
          {format(steps[steps.length - 1]!.ceiling)}.
        </p>
      ) : (
        <ul className="divide-border border-border flex flex-col divide-y border-y">
          {useful.map((step) => (
            <li key={step.ceiling.amount} className="flex items-start justify-between gap-3 py-2.5">
              <div className="min-w-0 text-sm">
                <p className="text-ink font-medium tabular-nums">Up to {format(step.ceiling)}</p>
                <p className="text-ink-muted text-xs">
                  {step.extraTrips} more {step.extraTrips === 1 ? 'trip' : 'trips'}
                  {step.best
                    ? `, best ${step.best.candidate.destinationName} at ${format(step.best.cost.total)}`
                    : ''}
                </p>
              </div>
              <a
                href={hrefFor(toMajor(step.ceiling))}
                className="text-tint-ink shrink-0 text-sm font-medium underline-offset-4 hover:underline"
              >
                Try it<span className="sr-only"> with a maximum of {format(step.ceiling)}</span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
