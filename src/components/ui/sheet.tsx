'use client';

import * as React from 'react';
import { Dialog as RadixDialog } from 'radix-ui';
import { cn } from '@/lib/cn';

/**
 * A panel that slides in from the edge and takes the page's focus.
 *
 * Radix Dialog does the hard parts - the focus trap, Escape, restoring focus
 * to the trigger, `aria-modal`, scroll locking - and this only dresses it in
 * the product's own surface. The phone menu is the one user today.
 *
 * The slide is a transform on a single element and is shortened to a fade
 * under `prefers-reduced-motion` by the global rule.
 */

export const Sheet = RadixDialog.Root;
export const SheetTrigger = RadixDialog.Trigger;
export const SheetClose = RadixDialog.Close;

export interface SheetContentProps extends React.ComponentPropsWithoutRef<'div'> {
  /** The accessible name of the dialog. Required: a dialog with no name is announced as nothing. */
  title: string;
  /** `bottom` is the phone's summary sheet: full width, up to 85% of the screen. */
  side?: 'right' | 'left' | 'bottom';
}

export const SheetContent = React.forwardRef<HTMLDivElement, SheetContentProps>(
  function SheetContent({ className, children, title, side = 'right', ...props }, ref) {
    return (
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="voyagr-sheet-overlay fixed inset-0 z-40 bg-black/60" />
        <RadixDialog.Content
          ref={ref}
          aria-describedby={undefined}
          data-side={side}
          className={cn(
            'voyagr-sheet bg-surface-raised text-ink border-border shadow-floating fixed z-50 flex flex-col overflow-y-auto',
            side === 'bottom'
              ? 'inset-x-0 bottom-0 max-h-[85dvh] rounded-t-(--radius-shell) border-t'
              : 'inset-y-0 w-[min(22rem,calc(100vw-2rem))] border-l',
            side === 'right' ? 'right-0' : side === 'left' ? 'left-0' : null,
            className,
          )}
          {...props}
        >
          <RadixDialog.Title className="sr-only">{title}</RadixDialog.Title>
          {children}
        </RadixDialog.Content>
      </RadixDialog.Portal>
    );
  },
);
