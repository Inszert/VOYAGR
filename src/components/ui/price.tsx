import * as React from 'react';
import { cn } from '@/lib/cn';

/**
 * A price, presented.
 *
 * **This component does no arithmetic and never will.** It takes strings that
 * `format()` already produced from a `Money`, because the moment a component
 * can add two numbers together is the moment a total on a card stops agreeing
 * with the total in the cost engine. See `src/core/trip/cost.ts`.
 *
 * What it does own is the hierarchy. A price is the second thing somebody
 * reads on a result card, after the destination, and "Total: EUR 487.00" in
 * the same size as everything around it is not a price anybody can compare at
 * a glance. So: the amount is large, tabular and quiet-coloured, and what it
 * means sits under it in small type.
 *
 * Tabular figures are the point of the whole component. Ten results in a
 * column with proportional digits do not line up, and a column of prices that
 * does not line up cannot be scanned.
 */

export type PriceSize = 'sm' | 'md' | 'lg' | 'xl';

const AMOUNT_CLASSES: Record<PriceSize, string> = {
  sm: 'text-base font-semibold',
  md: 'text-xl font-semibold',
  lg: 'text-2xl font-semibold',
  // The headline on the trip that is the answer.
  xl: 'text-3xl font-semibold tracking-tight',
};

export interface PriceProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Already formatted from a `Money`. Never a number. */
  amount: string;
  /** What the amount is for - "total · 5 nights". Small, under the figure. */
  caption?: React.ReactNode;
  /** One more line of qualification, quieter still. */
  note?: React.ReactNode;
  size?: PriceSize;
  align?: 'start' | 'end';
  /** A provenance badge or similar, beside the figure rather than in a footnote. */
  badge?: React.ReactNode;
  /** Set when the price sits on a photograph and needs its own contrast. */
  onImage?: boolean;
}

export function Price({
  amount,
  caption,
  note,
  size = 'md',
  align = 'start',
  badge,
  onImage = false,
  className,
  ...props
}: PriceProps) {
  return (
    <div
      className={cn('flex flex-col gap-0.5', align === 'end' && 'items-end text-right', className)}
      {...props}
    >
      <p
        className={cn(
          'flex items-center gap-2 tabular-nums',
          align === 'end' && 'justify-end',
          onImage ? 'text-white' : 'text-ink',
          AMOUNT_CLASSES[size],
        )}
      >
        {amount}
        {badge}
      </p>

      {caption ? (
        <p className={cn('text-sm tabular-nums', onImage ? 'text-white/75' : 'text-ink-muted')}>
          {caption}
        </p>
      ) : null}

      {note ? <div className="text-sm">{note}</div> : null}
    </div>
  );
}
