import * as React from 'react';
import { cn } from '@/lib/cn';

/**
 * Tag and filter chip.
 *
 * Two components because they are two different things wearing the same shape.
 * A `Tag` states a fact about something - "Beach", "Direct". A `ToggleChip`
 * changes what the user is looking at.
 *
 * Making a filter look like a button and behave like a button is how a filter
 * ends up unusable without JavaScript. `ToggleChip` is a real checkbox with a
 * real label, so it submits inside a GET form, restores from a URL and is
 * announced as a checkbox - it just does not look like one.
 */

export type TagTone = 'neutral' | 'brand' | 'accent';

const TAG_TONES: Record<TagTone, string> = {
  neutral: 'border-border bg-surface-sunken text-ink-muted',
  brand: 'border-brand-500/30 bg-brand-500/10 text-brand-ink',
  accent: 'border-accent-500/40 bg-accent-500/15 text-ink',
};

export interface TagProps extends React.HTMLAttributes<HTMLSpanElement> {
  tone?: TagTone;
}

export function Tag({ className, tone = 'neutral', ...props }: TagProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-[--radius-pill] border px-3 py-1 text-sm',
        TAG_TONES[tone],
        className,
      )}
      {...props}
    />
  );
}

export interface ToggleChipProps extends Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  'type' | 'className'
> {
  label: string;
  /** Secondary text, e.g. a count of matching results. */
  hint?: string;
  className?: string;
}

export const ToggleChip = React.forwardRef<HTMLInputElement, ToggleChipProps>(function ToggleChip(
  { label, hint, className, ...props },
  ref,
) {
  return (
    <label
      className={cn(
        'border-border bg-surface-raised text-ink inline-flex cursor-pointer items-center gap-2',
        'rounded-[--radius-pill] border px-3 py-1.5 text-sm',
        'ease-standard duration-quick transition-colors',
        'hover:bg-surface-sunken',
        // The checked state is carried by the border and weight as well as by
        // the tint, so it survives a monochrome display and forced colours.
        'has-checked:border-brand-500 has-checked:bg-brand-500/10 has-checked:text-brand-ink has-checked:font-medium',
        // The ring belongs on the label, since the input itself is hidden.
        'has-focus-visible:outline-brand-500 has-focus-visible:outline-2 has-focus-visible:outline-offset-2',
        className,
      )}
    >
      {/*
        Hidden from sight, not from assistive technology or from the form.
        `appearance-none` with zero size would drop it out of the tab order in
        some browsers; `sr-only` keeps it focusable and submittable.
      */}
      {/*
        Named explicitly when there is a hint.
        
        Name computation joins the label and the hint without a separator, so
        "Beach" plus "12" is announced as "Beach12" however far apart they look
        on screen. The explicit name still contains the visible text in order,
        which is what WCAG 2.5.3 requires of a label.
      */}
      <input
        ref={ref}
        type="checkbox"
        className="sr-only"
        {...(hint ? { 'aria-label': `${label} ${hint}` } : {})}
        {...props}
      />
      {label}
      {hint ? <span className="text-ink-muted">{hint}</span> : null}
    </label>
  );
});

export interface RadioChipProps extends Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  'type' | 'className'
> {
  label: string;
  /** Secondary text explaining what choosing this does. */
  hint?: string;
  className?: string;
}

/**
 * One-of-many chip.
 *
 * A radio rather than a checkbox, because the choices it carries are mutually
 * exclusive and a checkbox that behaves like a radio is a lie told to a screen
 * reader. Same shape as `ToggleChip` on purpose: they sit next to each other
 * and the difference the user needs to feel is "pick one" versus "pick any",
 * which the role already tells them.
 *
 * Every chip in a group shares a `name`, so the group is announced as a group
 * and arrow keys move within it - both for free, and neither available to a
 * button that sets a query parameter.
 */
export const RadioChip = React.forwardRef<HTMLInputElement, RadioChipProps>(function RadioChip(
  { label, hint, className, ...props },
  ref,
) {
  return (
    <label
      className={cn(
        'border-border bg-surface-raised text-ink inline-flex cursor-pointer items-center gap-2',
        'rounded-[--radius-pill] border px-3 py-1.5 text-sm',
        'ease-standard duration-quick transition-colors',
        'hover:bg-surface-sunken',
        'has-checked:border-brand-500 has-checked:bg-brand-500/10 has-checked:text-brand-ink has-checked:font-medium',
        'has-focus-visible:outline-brand-500 has-focus-visible:outline-2 has-focus-visible:outline-offset-2',
        className,
      )}
    >
      {/*
        The hint is part of the accessible name rather than a `title` or a
        separate paragraph: it is the difference between "± 3 days" and every
        other "± 3 days" a person might have seen, and reading the chip without
        it leaves the choice genuinely ambiguous.
      */}
      <input
        ref={ref}
        type="radio"
        className="sr-only"
        {...(hint ? { 'aria-label': `${label}. ${hint}` } : {})}
        {...props}
      />
      {label}
    </label>
  );
});
