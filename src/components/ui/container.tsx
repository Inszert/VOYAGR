import * as React from 'react';
import { cn } from '@/lib/cn';

/**
 * The reading column.
 *
 * The root layout used to constrain `<main>` for every page. The discovery
 * stage bleeds to the viewport edge, so the column moved here and a page that
 * wants one says so. `wide` is for surfaces that put a globe beside a list;
 * the default is the measure every other page was designed at.
 */

export interface ContainerProps extends React.HTMLAttributes<HTMLDivElement> {
  size?: 'default' | 'wide';
  /** Render as a different element, e.g. a `section` that is also a landmark. */
  as?: 'div' | 'section';
}

/**
 * The measure, in one place.
 *
 * 1216px for a surface that puts a globe beside a list, and a reading column
 * for everything else. Both sit in the same 48px gutter on a desktop, so the
 * nav, the hero and the band below it line up down the left edge of the page -
 * which is the whole of why the content used to read as scattered across a
 * screen rather than laid out on one.
 *
 * The gutter narrows on a phone, where 48px of nothing either side of a
 * 375px screen is a quarter of the viewport spent on margin.
 */
export function Container({
  size = 'default',
  as: Component = 'div',
  className,
  ...props
}: ContainerProps) {
  return (
    <Component
      className={cn(
        'mx-auto w-full px-5 md:px-12',
        size === 'wide' ? 'max-w-[1216px]' : 'max-w-[896px]',
        className,
      )}
      {...props}
    />
  );
}
