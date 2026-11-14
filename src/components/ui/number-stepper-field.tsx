'use client';

import * as React from 'react';
import { Label } from 'radix-ui';
import { cn } from '@/lib/cn';
import { Icon } from './icon';

/**
 * A bounded integer count, with its own up/down buttons.
 *
 * The native `type="number"` spinner is drawn by the operating system, in
 * whatever colours its theme happens to use - light-on-light in a browser
 * chrome dropped onto a dark page, or invisible altogether depending on the
 * platform. For a small, genuinely bounded count like a traveller total
 * (1 to 9, never a price or anything that benefits from typing a precise
 * figure), a pair of buttons this system actually draws reads as deliberate
 * where the native spinner read as an accident of the browser.
 *
 * **The input itself is untouched.** It keeps its name, is still a real
 * `type="number"` with the same `min`/`max`, still submits with the form,
 * and can still be typed into directly - the buttons are an addition, not a
 * replacement. They call the input's own `stepUp`/`stepDown`, the same
 * native method a spinner arrow would, so `min`/`max`/`step` are honoured by
 * the platform rather than reimplemented here.
 */

export interface NumberStepperFieldProps extends Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  'id' | 'type'
> {
  label: string;
  hint?: string;
  error?: string;
  hideLabel?: boolean;
  /** Drop the control's own border and background. See `Field`. */
  bare?: boolean;
}

export const NumberStepperField = React.forwardRef<HTMLInputElement, NumberStepperFieldProps>(
  function NumberStepperField(
    { label, hint, error, hideLabel = false, bare = false, className, required, ...props },
    forwardedRef,
  ) {
    const id = React.useId();
    const hintId = `${id}-hint`;
    const errorId = `${id}-error`;
    const innerRef = React.useRef<HTMLInputElement | null>(null);

    const setRef = (node: HTMLInputElement | null) => {
      innerRef.current = node;
      if (typeof forwardedRef === 'function') forwardedRef(node);
      else if (forwardedRef) forwardedRef.current = node;
    };

    const describedBy =
      [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(' ') || undefined;

    const step = (direction: 'up' | 'down') => {
      const input = innerRef.current;
      if (!input) return;

      if (direction === 'up') input.stepUp();
      else input.stepDown();
      // A click moves the value the same way typing a new one would, so
      // anything reading the field as a controlled input hears about it.
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    };

    return (
      <div className={cn('flex flex-col', bare ? 'gap-0.5' : 'gap-1.5')}>
        <Label.Root
          htmlFor={id}
          className={cn(
            hideLabel && 'sr-only',
            bare
              ? 'text-dim text-[11px] leading-[1.15] font-medium tracking-[0.02em] uppercase'
              : 'text-ink text-sm font-medium',
          )}
        >
          {label}
          {required ? (
            <>
              {' '}
              <span aria-hidden="true" className="text-critical-ink">
                *
              </span>
              <span className="sr-only">(required)</span>
            </>
          ) : null}
        </Label.Root>

        <div className="relative">
          <input
            ref={setRef}
            id={id}
            type="number"
            required={required}
            aria-describedby={describedBy}
            aria-invalid={error ? true : undefined}
            className={cn(
              'text-text w-full min-w-0 text-[16px] sm:text-[14px]',
              'placeholder:text-dim',
              'disabled:cursor-not-allowed disabled:opacity-70',
              // The native spinner is replaced by the buttons beside it, not
              // merely hidden - without this a second, undrawn one would
              // still eat clicks in the same corner as the real ones.
              '[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none',
              bare
                ? 'h-7 truncate border-0 bg-transparent p-0 pr-9 focus:outline-none'
                : cn(
                    'bg-surface-raised h-11 rounded-(--radius-control) border py-3 pr-11 pl-3',
                    error ? 'border-critical-500' : 'border-border-strong',
                  ),
              className,
            )}
            {...props}
          />

          <div
            className={cn(
              'absolute top-1/2 right-0 flex -translate-y-1/2 flex-col',
              bare ? 'gap-0' : 'mr-1.5 gap-px',
            )}
          >
            <button
              type="button"
              tabIndex={-1}
              onClick={() => step('up')}
              aria-label={`Increase ${label.toLowerCase()}`}
              className={cn(
                'text-dim hover:text-text focus-visible:outline-accent-ink grid place-items-center',
                'disabled:pointer-events-none disabled:opacity-30',
                bare ? 'size-4' : 'size-5 rounded-t-[4px]',
              )}
            >
              <Icon name="chevron-up" className="size-3" />
            </button>
            <button
              type="button"
              tabIndex={-1}
              onClick={() => step('down')}
              aria-label={`Decrease ${label.toLowerCase()}`}
              className={cn(
                'text-dim hover:text-text focus-visible:outline-accent-ink grid place-items-center',
                'disabled:pointer-events-none disabled:opacity-30',
                bare ? 'size-4' : 'size-5 rounded-b-[4px]',
              )}
            >
              <Icon name="chevron-down" className="size-3" />
            </button>
          </div>
        </div>

        {hint && !bare ? (
          <p id={hintId} className="text-ink-muted text-sm">
            {hint}
          </p>
        ) : null}
        {hint && bare ? (
          <p id={hintId} className="sr-only">
            {hint}
          </p>
        ) : null}

        <p
          id={errorId}
          role="alert"
          aria-live="polite"
          className="text-critical-ink text-sm empty:hidden"
        >
          {error}
        </p>
      </div>
    );
  },
);
