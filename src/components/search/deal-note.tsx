import { abs, format } from '@/core/money';
import { cn } from '@/lib/cn';
import type { DealAgainstTypical } from '@/search/deal-score';

/**
 * A trip against the typical trip to the same place, in one line.
 *
 * Only what the search itself found: the typical total is the middle of the
 * trips it priced for this destination, and the line says how many that was.
 */
export function DealNote({
  deal,
  onImage = false,
  className,
}: {
  deal: DealAgainstTypical | null | undefined;
  onImage?: boolean;
  className?: string;
}) {
  if (!deal) return null;

  const { difference, basis } = deal;
  const cheaper = difference.amount < 0;

  return (
    <p
      className={cn(
        'text-xs tabular-nums',
        onImage ? 'text-white/80' : 'text-ink-muted',
        className,
      )}
    >
      {difference.amount === 0 ? (
        'The typical price for here'
      ) : (
        <>
          <span className={cn('font-semibold', cheaper && !onImage && 'text-tint-ink')}>
            {format(abs(difference))} {cheaper ? 'below' : 'above'}
          </span>{' '}
          the typical trip here
        </>
      )}{' '}
      ({basis} priced)
    </p>
  );
}
