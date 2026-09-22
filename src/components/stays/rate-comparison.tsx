import { format } from '@/core/money';
import { DIFFERENCE_LABEL, type PriceComparison } from '@/core/stay/comparison';
import { SourceTag } from '@/components/ui';
import { cn } from '@/lib/cn';
import { BOARD_LABEL, cancellationLabel } from './stay-card';

/**
 * Every rate for one property, measured against the one the user picked.
 *
 * **The reference is whichever rate is selected, never a fixed provider.**
 * Anchoring on one vendor would make every other vendor read as the
 * exception, which is a claim about them rather than about their price.
 * Selecting any row re-anchors the whole table.
 *
 * **A difference is never shown alone when the rates differ.** A cheaper
 * non-refundable room without breakfast is not "22 cheaper" - it is a
 * different product at a different price, and the conditions that differ are
 * printed beside the number rather than left for somebody to discover at the
 * hotel desk. `differencesBetween` decides what those are; this only renders
 * them.
 */

export interface RateComparisonProps {
  readonly comparison: readonly PriceComparison[];
  /** Link that makes a rate the reference. */
  readonly hrefFor: (comparison: PriceComparison) => string;
}

function priceDifference(entry: PriceComparison): string {
  if (entry.isReference) return 'Your selected rate';
  if (!entry.difference) return 'Priced in another currency';
  if (entry.difference.amount === 0) return 'Same price';

  const magnitude = format({
    amount: Math.abs(entry.difference.amount),
    currency: entry.difference.currency,
  });

  const percent = entry.fraction === null ? '' : ` · ${Math.abs(entry.fraction * 100).toFixed(1)}%`;

  return `${magnitude}${percent} ${entry.cheaper ? 'cheaper' : 'more expensive'}`;
}

export function RateComparison({ comparison, hrefFor }: RateComparisonProps) {
  return (
    <section aria-labelledby="compare-heading" className="flex flex-col gap-3">
      <h2 id="compare-heading" className="text-ink text-lg font-medium">
        Compare prices
      </h2>

      <ul className="flex flex-col gap-2">
        {comparison.map((entry) => (
          <li key={entry.rate.id}>
            <div
              className={cn(
                'border-border bg-surface-raised rounded-[--radius-control] border p-3',
                entry.isReference && 'border-accent-to',
              )}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex min-w-0 flex-col gap-1">
                  <SourceTag source={entry.rate.source} className="w-fit" />

                  <p className="text-ink text-sm font-medium">
                    {entry.rate.roomName ?? 'Room'}
                    {entry.rate.bedConfiguration ? ` · ${entry.rate.bedConfiguration}` : ''}
                  </p>

                  <p className="text-ink-muted text-sm">
                    {entry.rate.board ? BOARD_LABEL[entry.rate.board] : 'Board not stated'} ·{' '}
                    {cancellationLabel(entry.rate)}
                  </p>

                  <p className="text-ink-muted text-sm">
                    {entry.rate.occupancy.adults} guests · {entry.rate.occupancy.rooms} room
                    {entry.rate.occupancy.rooms === 1 ? '' : 's'}
                    {entry.rate.paymentTiming
                      ? ` · ${entry.rate.paymentTiming === 'pay_now' ? 'Pay now' : 'Pay later'}`
                      : ''}
                  </p>

                  {entry.rate.benefits.length > 0 ? (
                    <p className="text-ink-muted text-sm">{entry.rate.benefits.join(' · ')}</p>
                  ) : null}
                </div>

                <div className="text-right">
                  <p className="text-ink text-lg font-semibold tabular-nums">
                    {format(entry.rate.total)}
                  </p>
                  <p className="text-ink-muted text-sm tabular-nums">
                    {format(entry.rate.perNight)} a night
                  </p>
                  {entry.rate.taxesAndFees ? (
                    <p className="text-ink-muted text-xs tabular-nums">
                      includes {format(entry.rate.taxesAndFees)} tax and fees
                    </p>
                  ) : (
                    <p className="text-ink-muted text-xs">Taxes and fees not itemised</p>
                  )}

                  <p
                    className={cn(
                      'mt-1 text-sm',
                      entry.isReference ? 'text-accent-ink font-medium' : 'text-ink',
                    )}
                  >
                    {priceDifference(entry)}
                  </p>

                  {entry.isReference ? null : (
                    <a
                      href={hrefFor(entry)}
                      className="text-accent-ink focus-visible:outline-accent-to mt-1 inline-block rounded-sm text-sm focus-visible:outline-2 focus-visible:outline-offset-2"
                    >
                      Compare from this rate
                    </a>
                  )}
                </div>
              </div>

              {/*
                The qualification, never omitted.

                A price difference with no note beside it says these two rates
                buy the same thing. When they do not, that sentence is the
                most important one on the row.
              */}
              {entry.differences.length > 0 ? (
                <p className="border-border text-caution-ink mt-2 border-t pt-2 text-sm">
                  Not the same offer: {entry.differences.map((d) => DIFFERENCE_LABEL[d]).join(', ')}
                  .
                </p>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
