'use client';

import * as React from 'react';
import { Collapsible as RadixCollapsible } from 'radix-ui';
import { cn } from '@/lib/cn';

/**
 * A quiet, inline show-and-hide: one line that opens to more.
 *
 * Radix owns the button, `aria-expanded`, `aria-controls` and keyboard
 * activation. The `Disclosure` is a bordered `<details>` for a section of a
 * page; this is the small one for the inside of a row, where a border around a
 * single line would be a box inside a card.
 *
 * The trigger is at least 44px tall, and `relative z-10` so that it stays
 * clickable when the row it sits in is covered by a stretched link.
 */

export interface CollapsibleProps {
  /** The always-visible words, e.g. "2 things to check". */
  summary: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  /** Tone of the summary text. The words carry the meaning; this is only weight. */
  tone?: 'caution' | 'critical' | 'muted';
}

const TONE = {
  caution: 'text-caution-ink',
  critical: 'text-critical-ink',
  muted: 'text-ink-muted',
} as const;

export function Collapsible({ summary, children, className, tone = 'caution' }: CollapsibleProps) {
  return (
    <RadixCollapsible.Root className={cn('group/collapsible relative z-10 min-w-0', className)}>
      <RadixCollapsible.Trigger
        className={cn(
          'inline-flex min-h-11 cursor-pointer items-center gap-1.5 text-sm font-medium underline-offset-4 hover:underline',
          'focus-visible:outline-accent-to focus-visible:outline-2 focus-visible:outline-offset-2',
          TONE[tone],
        )}
      >
        {summary}
        <span
          aria-hidden="true"
          className="ease-standard duration-quick transition-transform group-data-[state=open]/collapsible:rotate-90"
        >
          &rsaquo;
        </span>
      </RadixCollapsible.Trigger>
      <RadixCollapsible.Content className="pb-1">{children}</RadixCollapsible.Content>
    </RadixCollapsible.Root>
  );
}
