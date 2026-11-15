import * as React from 'react';
import { cn } from '@/lib/cn';

/**
 * A plan item's status, as a word and a shape.
 *
 * Idea is a dashed ring, planned a half-filled one, booked a ring with a tick.
 * The shape is a second signal beside the colour, and the word is a third:
 * nobody has to tell green from violet to know what is booked.
 */

export type StatusChipKind = 'idea' | 'planned' | 'booked';

const TONE: Record<StatusChipKind, string> = {
  idea: 'bg-surface-sunken text-ink-muted border-border-strong',
  planned: 'bg-brand-500/10 text-brand-ink border-brand-500/30',
  booked: 'bg-positive-500/10 text-positive-ink border-positive-500/30',
};

function Mark({ kind }: { kind: StatusChipKind }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" className="size-3.5 shrink-0" fill="none">
      <circle
        cx="8"
        cy="8"
        r="6"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeDasharray={kind === 'idea' ? '2.5 2.5' : undefined}
      />
      {kind === 'planned' ? <path d="M8 2a6 6 0 0 1 0 12z" fill="currentColor" /> : null}
      {kind === 'booked' ? (
        <path
          d="m5.2 8.2 2 2 3.6-4"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ) : null}
    </svg>
  );
}

export function StatusChip({
  kind,
  children,
  className,
}: {
  kind: StatusChipKind;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium',
        TONE[kind],
        className,
      )}
    >
      <span className="sr-only">Status: </span>
      <Mark kind={kind} />
      {children}
    </span>
  );
}
