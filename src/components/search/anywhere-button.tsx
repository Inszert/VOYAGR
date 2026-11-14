'use client';

import { ANYWHERE } from '@/search/schema';
import { setNatively } from '@/components/ui/calendar-month';
import { cn } from '@/lib/cn';

/**
 * "I don't mind where" - or "somewhere in Oceania".
 *
 * Fills the destination field with one word the search understands: by default
 * `anywhere`, everywhere it can actually price, or a region such as `oceania`,
 * everywhere it can price in that part of the world. A convenience rather than
 * the mechanism: typing the word by hand works identically, which is what
 * keeps this working for somebody with no JavaScript.
 *
 * Written through the native setter so React, the form and anything else
 * listening all see the change - the same reason the calendar does it.
 */
export function AnywhereButton({
  targetName,
  value = ANYWHERE,
  label = 'Anywhere',
  className,
}: {
  readonly targetName: string;
  /** The word written into the field. */
  readonly value?: string;
  /** What the button says. */
  readonly label?: string;
  readonly className?: string;
}) {
  return (
    <button
      type="button"
      onClick={(event) => {
        const form = event.currentTarget.closest('form');
        const field = form?.elements.namedItem(targetName);

        if (field instanceof HTMLInputElement) {
          setNatively(field, value);
          field.focus();
        }

        // A choice made from the regions panel closes it.
        event.currentTarget.closest('details')?.removeAttribute('open');
      }}
      className={cn(
        'border-hairline text-ink-muted rounded-(--radius-pill) border px-3 py-1.5 text-xs font-medium',
        'ease-standard duration-quick transition-colors',
        'hover:border-border-strong hover:text-ink',
        'focus-visible:outline-accent-to focus-visible:outline-2 focus-visible:outline-offset-2',
        className,
      )}
    >
      {label}
    </button>
  );
}
