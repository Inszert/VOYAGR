'use client';

import * as React from 'react';
import { Popover as RadixPopover } from 'radix-ui';
import { cn } from '@/lib/cn';

/**
 * The one panel every menu, picker and calendar opens into.
 *
 * Before this there was no shared layer at all: the date field was a native
 * `<input type="date">` whose picker is browser chrome outside the DOM and
 * cannot be styled at all, the traveller count was a spinner, and the region
 * list was a native `<select>` whose open list is drawn by the operating
 * system. Three controls, three different looks, none of them ours.
 *
 * So anything that opens over the page comes through here and inherits one
 * surface: the panel colour, the hairline, the corner radius, the shadow and
 * the open and close motion. Restyling all of them is editing this file.
 *
 * **It does not replace the control underneath.** Every form on this site is
 * a plain GET that has to work before JavaScript arrives, so the native input
 * stays in the DOM and stays the thing that gets submitted - see `DateField`
 * and `Select`. This is a better way to set that value, not a different
 * source of truth for it.
 */

export interface PopoverPanelProps extends React.ComponentPropsWithoutRef<'div'> {
  /** Where the panel sits relative to its trigger. */
  side?: 'top' | 'right' | 'bottom' | 'left';
  align?: 'start' | 'center' | 'end';
  /** Distance from the trigger, in pixels. */
  sideOffset?: number;
}

export const Popover = RadixPopover.Root;
export const PopoverTrigger = RadixPopover.Trigger;
export const PopoverClose = RadixPopover.Close;
export const PopoverAnchor = RadixPopover.Anchor;

export const PopoverPanel = React.forwardRef<HTMLDivElement, PopoverPanelProps>(
  function PopoverPanel(
    { className, children, side = 'bottom', align = 'start', sideOffset = 8, ...props },
    ref,
  ) {
    return (
      <RadixPopover.Portal>
        <RadixPopover.Content
          ref={ref}
          side={side}
          align={align}
          sideOffset={sideOffset}
          /*
           * Collision handling on, so a panel opened near the bottom of a
           * phone flips above its trigger instead of being clipped, and one
           * opened beside the right edge slides back into view.
           */
          collisionPadding={12}
          className={cn('voyagr-popover', className)}
          {...props}
        >
          {children}
        </RadixPopover.Content>
      </RadixPopover.Portal>
    );
  },
);
