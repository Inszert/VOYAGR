'use client';

import * as React from 'react';
import { Label } from 'radix-ui';
import { cn } from '@/lib/cn';

/**
 * Form field.
 *
 * Wires up the four things a text input needs to be accessible, so no call site
 * has to remember them:
 *  - a `<label>` genuinely associated with the control via `htmlFor`/`id`;
 *  - hint and error text linked through `aria-describedby`;
 *  - `aria-invalid` when there is an error;
 *  - error text in a live region, so a validation failure is announced rather
 *    than only appearing.
 *
 * Ids are generated with `useId`, which keeps them stable across server and
 * client rendering.
 */

export interface FieldProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'id'> {
  label: string;
  /** Supporting text shown under the control. */
  hint?: string;
  /** Validation message. Its presence marks the control invalid. */
  error?: string;
  /** Visually hide the label while keeping it available to assistive tech. */
  hideLabel?: boolean;
}

export const Field = React.forwardRef<HTMLInputElement, FieldProps>(function Field(
  { label, hint, error, hideLabel = false, className, required, ...props },
  ref,
) {
  const id = React.useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;

  const describedBy =
    [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(' ') || undefined;

  return (
    <div className="flex flex-col gap-1.5">
      <Label.Root
        htmlFor={id}
        className={cn('text-ink text-sm font-medium', hideLabel && 'sr-only')}
      >
        {label}
        {required ? (
          <>
            {' '}
            <span aria-hidden="true" className="text-critical-500">
              *
            </span>
            <span className="sr-only">(required)</span>
          </>
        ) : null}
      </Label.Root>

      <input
        ref={ref}
        id={id}
        required={required}
        aria-describedby={describedBy}
        aria-invalid={error ? true : undefined}
        className={cn(
          'bg-surface-raised text-ink h-11 rounded-[--radius-control] border px-3 text-base',
          'placeholder:text-ink-muted',
          'disabled:cursor-not-allowed disabled:opacity-70',
          error ? 'border-critical-500' : 'border-border-strong',
          className,
        )}
        {...props}
      />

      {hint ? (
        <p id={hintId} className="text-ink-muted text-sm">
          {hint}
        </p>
      ) : null}

      {/*
        The live region is always present, not conditionally rendered: a region
        that appears at the same moment as its content is often missed by screen
        readers.
      */}
      <p
        id={errorId}
        role="alert"
        aria-live="polite"
        className="text-critical-500 text-sm empty:hidden"
      >
        {error}
      </p>
    </div>
  );
});
