import * as React from 'react';
import { cn } from '@/lib/cn';

/**
 * Skip link.
 *
 * The first focusable element on the page. Hidden until focused, then visible
 * and fully styled, letting a keyboard user jump past the header straight to the
 * main content (WCAG 2.4.1, Bypass Blocks).
 *
 * Implemented with `sr-only` plus `focus:not-sr-only` rather than an off-screen
 * transform, so it works under forced-colors mode too.
 */

export interface SkipLinkProps extends React.AnchorHTMLAttributes<HTMLAnchorElement> {
  /** The id of the element to skip to, without the leading hash. */
  targetId: string;
}

export function SkipLink({ targetId, className, children, ...props }: SkipLinkProps) {
  return (
    <a
      href={`#${targetId}`}
      className={cn(
        'sr-only',
        'focus:not-sr-only focus:absolute focus:top-3 focus:left-3 focus:z-50',
        'focus:bg-brand-600 focus:rounded-[--radius-control] focus:px-4 focus:py-2',
        'focus:text-base focus:font-medium focus:text-white',
        className,
      )}
      {...props}
    >
      {children ?? 'Skip to main content'}
    </a>
  );
}
