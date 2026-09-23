import * as React from 'react';
import { cn } from '@/lib/cn';
import { Icon, type IconName } from './icon';

/**
 * A short run of labelled facts, as one object.
 *
 * Each of these used to be its own bordered, filled tile, which is how a card
 * ends up looking like a page of cards: four boxes inside a box, above a
 * fifth box, beside a sixth. Four boxes are not a hierarchy, they are four
 * boxes.
 *
 * One panel with hairlines between its cells says the same thing and reads as
 * part of the card that holds it. It is also the same treatment as the
 * disclosure panel further down the card, so a result reads as two grouped
 * regions rather than as nine unrelated rectangles.
 *
 * A `dl`, because that is what it is: terms and their values. The icons are
 * decoration - every cell says its own name beside one.
 */

export interface Fact {
  readonly key: string;
  readonly icon?: IconName;
  readonly label: string;
  readonly value: React.ReactNode;
  /** Anything that belongs under the value - a source tag, a qualifier. */
  readonly detail?: React.ReactNode;
}

export interface FactGridProps extends React.HTMLAttributes<HTMLDListElement> {
  facts: readonly Fact[];
  /** Cells across, at the widest breakpoint. Two below it, always. */
  columns?: 2 | 3 | 4;
}

const COLUMN_CLASSES: Record<2 | 3 | 4, string> = {
  2: 'sm:grid-cols-2',
  3: 'sm:grid-cols-3',
  4: 'sm:grid-cols-4',
};

export function FactGrid({ facts, columns = 4, className, ...props }: FactGridProps) {
  return (
    <dl
      className={cn(
        'border-border grid grid-cols-2 overflow-hidden rounded-(--radius-card) border',
        // Hairlines between the cells rather than around each of them. The
        // negative margins are what stop a double rule where cells meet.
        '[&>div]:border-border [&>div]:-mt-px [&>div]:-ml-px [&>div]:border-t [&>div]:border-l',
        COLUMN_CLASSES[columns],
        className,
      )}
      {...props}
    >
      {facts.map((fact) => (
        <div key={fact.key} className="px-4 py-3">
          <dt className="text-ink-muted flex items-center gap-1.5 text-xs">
            {fact.icon ? <Icon name={fact.icon} size={0.95} /> : null}
            {fact.label}
          </dt>
          <dd className="text-ink mt-1 text-sm tabular-nums">
            {fact.value}
            {fact.detail}
          </dd>
        </div>
      ))}
    </dl>
  );
}
