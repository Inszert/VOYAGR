'use client';

import { ANYWHERE } from '@/search/schema';
import { setNatively } from '@/components/ui/calendar-month';

/**
 * "I don't mind where."
 *
 * Fills the destination field with the one word the search understands as
 * everywhere it can actually price. A convenience rather than the mechanism:
 * typing `anywhere` by hand works identically, which is what keeps this
 * working for somebody with no JavaScript.
 *
 * Written through the native setter so React, the form and anything else
 * listening all see the change - the same reason the calendar does it.
 */
export function AnywhereButton({ targetName }: { readonly targetName: string }) {
  return (
    <button
      type="button"
      onClick={(event) => {
        const form = event.currentTarget.closest('form');
        const field = form?.elements.namedItem(targetName);

        if (field instanceof HTMLInputElement) {
          setNatively(field, ANYWHERE);
          field.focus();
        }
      }}
      className="text-dim hover:text-text focus-visible:outline-accent-to rounded-sm text-[11px] underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2"
    >
      Anywhere
    </button>
  );
}
