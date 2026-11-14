import * as React from 'react';
import { cn } from '@/lib/cn';
import { Icon } from './icon';

/**
 * Select.
 *
 * A native `<select>`, deliberately, where the rest of the system reaches for a
 * Radix primitive. The search form is a plain GET form that must work before
 * JavaScript arrives and on a bad connection, and Radix's Select is a
 * JavaScript-driven listbox that renders nothing useful without it. The native
 * control is not a hand-rolled one: it is the platform's, with the keyboard
 * behaviour, typeahead and mobile pickers already correct.
 *
 * Reach for Radix Select when a control genuinely needs what the native one
 * cannot do - rich option content, or an async-loaded list.
 *
 * Label, hint and error wiring mirrors `Field`, so the two look and behave the
 * same in a form.
 */

export interface SelectOption {
  readonly value: string;
  readonly label: string;
}

export interface SelectProps extends Omit<React.SelectHTMLAttributes<HTMLSelectElement>, 'id'> {
  label: string;
  options: readonly SelectOption[];
  hint?: string;
  error?: string;
  hideLabel?: boolean;
  /** Drop the control's own border, for a segmented bar. */
  bare?: boolean;
}

export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { label, options, hint, error, hideLabel = false, bare = false, className, required, ...props },
  ref,
) {
  const id = React.useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;

  const describedBy =
    [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(' ') || undefined;

  return (
    <div className={cn('flex flex-col', bare ? 'gap-0.5' : 'gap-1.5')}>
      <label
        htmlFor={id}
        className={cn(
          hideLabel && 'sr-only',
          bare
            ? 'text-dim truncate text-[11px] font-medium tracking-[0.06em] whitespace-nowrap uppercase'
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
      </label>

      <div className="relative">
        <select
          ref={ref}
          id={id}
          required={required}
          aria-describedby={describedBy}
          aria-invalid={error ? true : undefined}
          className={cn(
            // `w-full min-w-0`: a select's intrinsic width is its longest option,
            // and left to itself it widens its grid column past the viewport.
            // `appearance-none` drops the platform's own arrow, which is drawn
            // in whatever style the OS theme happens to use - replaced below
            // with the one arrow this system actually draws.
            'text-text w-full min-w-0 appearance-none text-[16px] sm:text-[14px]',
            'disabled:cursor-not-allowed disabled:opacity-70',
            bare
              ? 'h-7 border-0 bg-transparent p-0 pr-4 focus:outline-none'
              : cn(
                  'bg-surface-raised h-11 rounded-(--radius-control) border py-3 pr-9 pl-3',
                  error ? 'border-critical-500' : 'border-border-strong',
                ),
            className,
          )}
          {...props}
        >
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>

        <Icon
          name="chevron-down"
          className={cn(
            'text-dim pointer-events-none absolute top-1/2 right-0 -translate-y-1/2',
            bare ? 'size-3' : 'mr-3 size-4',
          )}
        />
      </div>

      {hint ? (
        <p id={hintId} className={cn(bare ? 'sr-only' : 'text-ink-muted text-sm')}>
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
});
