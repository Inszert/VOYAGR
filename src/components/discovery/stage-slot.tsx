'use client';

import * as React from 'react';
import { registerStageSlot, releaseStageSlot, type StageVariant } from './stage-store';

/**
 * The box on a page that the one persistent globe fills.
 *
 * Renders an ordinary `div` and tells the stage store where it is. The globe
 * itself is not in here: it is mounted once by the `(stage)` layout and moved
 * to whichever slot the current page has, which is what keeps its tiles,
 * sources and camera alive across a navigation.
 */

/** The explorer's column, shared by the page and by its loading state. */
export const EXPLORE_SLOT_CLASS = 'relative h-[24rem] w-full sm:h-[32rem] lg:h-[40rem]';

export interface StageSlotProps extends React.ComponentPropsWithoutRef<'div'> {
  variant: StageVariant;
}

export function StageSlot({ variant, children, ...props }: StageSlotProps) {
  const ref = React.useRef<HTMLDivElement>(null);

  React.useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;

    registerStageSlot(element, variant);
    return () => releaseStageSlot(element);
  }, [variant]);

  return (
    <div ref={ref} data-stage-slot={variant} {...props}>
      {children}
    </div>
  );
}
