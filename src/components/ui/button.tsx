import * as React from 'react';
import { Slot } from 'radix-ui';
import { cn } from '@/lib/cn';

/**
 * Button.
 *
 * Accessibility notes:
 *  - Renders a real `<button>` by default. `asChild` delegates rendering to a
 *    child (usually a `Link`) via Radix's Slot, so a navigation control is an
 *    anchor and a command is a button - never a clickable `<div>`.
 *  - A `loading` button stays focusable and keeps its accessible name, and
 *    announces the state change through `aria-busy` rather than swapping its
 *    label out from under a screen reader.
 *  - Focus styling comes from the global `:focus-visible` rule, so every control
 *    in the app shares one indicator.
 */

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary:
    'bg-brand-600 text-white hover:bg-brand-700 active:bg-brand-800 disabled:bg-brand-600/50',
  secondary:
    'bg-surface-raised text-ink border border-border-strong hover:bg-surface-sunken active:bg-surface-sunken',
  ghost: 'bg-transparent text-ink hover:bg-surface-sunken active:bg-surface-sunken',
  danger:
    'bg-critical-700 text-white hover:bg-critical-500 active:bg-critical-700 disabled:bg-critical-700/50',
};

const SIZE_CLASSES: Record<ButtonSize, string> = {
  // Minimum 44px target height on md and lg, per WCAG 2.2 target size guidance.
  sm: 'h-9 px-3 text-sm gap-1.5',
  md: 'h-11 px-4 text-base gap-2',
  lg: 'h-12 px-6 text-base gap-2',
};

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Render the child element instead of a `<button>`, keeping the styling. */
  asChild?: boolean;
  /** Shows a busy state. The button stays focusable and keeps its label. */
  loading?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    className,
    variant = 'primary',
    size = 'md',
    asChild = false,
    loading = false,
    children,
    disabled,
    ...props
  },
  ref,
) {
  const Component = asChild ? Slot.Root : 'button';

  return (
    <Component
      ref={ref}
      // A busy button is disabled for interaction but not removed from the tab
      // order, so focus is not lost while a request is in flight.
      aria-busy={loading || undefined}
      disabled={disabled ?? (loading && !asChild)}
      className={cn(
        'inline-flex items-center justify-center rounded-[--radius-control] font-medium',
        'transition-colors duration-150',
        'disabled:cursor-not-allowed disabled:opacity-70',
        VARIANT_CLASSES[variant],
        SIZE_CLASSES[size],
        className,
      )}
      {...props}
    >
      {children}
    </Component>
  );
});
