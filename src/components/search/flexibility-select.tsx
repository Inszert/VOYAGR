'use client';

import * as React from 'react';
import { Select as RadixSelect } from 'radix-ui';
import { Icon } from '@/components/ui/icon';
import { cn } from '@/lib/cn';
import { FLEXIBILITY_LABELS, FLEXIBILITY_PRESETS, type FlexibilityPreset } from '@/search/flexibility';

/**
 * The date flexibility control, as a grouped listbox rather than a plain
 * `<select>`.
 *
 * `Select` stays a native control everywhere else deliberately - see its own
 * comment - but this one field earns the exception it already names: grouped
 * headings and a checkmark are rich option content a native `<option>`
 * cannot carry at all. Built on Radix rather than hand-rolled, so the open
 * and close behaviour, typeahead and keyboard navigation are the same ones
 * `DateRangeField`'s calendar already relies on, and the panel is the same
 * `.voyagr-popover` surface every other dropdown on the bar opens into.
 *
 * **Still one real control for the form.** Radix renders a visually hidden,
 * `aria-hidden` native `<select>` of its own next to the trigger - with the
 * same `name` and a real `<option>` per value - purely so the field still
 * submits like any other. The `:has()` rule that shows "Anytime that month"
 * elsewhere on this bar reads that hidden select's own `<option>`, which is
 * why choosing "Anytime that month" here still reveals it without this
 * component needing to know that field exists.
 */

export type FlexibilityValue = FlexibilityPreset | 'custom';

export interface FlexibilitySelectProps {
  label: string;
  name: string;
  defaultValue?: string;
  hint?: string;
  error?: string;
  hideLabel?: boolean;
  /** Drop the control's own border and background. See `Field`. */
  bare?: boolean;
  required?: boolean;
  className?: string;
}

interface Group {
  readonly heading: string;
  readonly options: readonly FlexibilityValue[];
}

/** 1.10.1 section 8's seven presets plus the one hand-typed window, grouped by what a traveller is actually choosing between. */
const GROUPS: readonly Group[] = [
  { heading: 'Flexible dates', options: ['plus-minus-1', 'plus-minus-3', 'plus-minus-7'] },
  { heading: 'Weekend trips', options: ['weekend', 'long-weekend'] },
  { heading: 'Other options', options: ['exact', 'month', 'custom'] },
];

const CUSTOM_VALUE = 'custom';
const CUSTOM_LABEL = 'Exact window';

function labelFor(value: FlexibilityValue): string {
  return value === CUSTOM_VALUE ? CUSTOM_LABEL : FLEXIBILITY_LABELS[value];
}

const DEFAULT_VALUE: FlexibilityValue = 'plus-minus-3';

function toValue(raw: string | undefined): FlexibilityValue {
  if (raw === CUSTOM_VALUE) return CUSTOM_VALUE;
  return (FLEXIBILITY_PRESETS as readonly string[]).includes(raw ?? '')
    ? (raw as FlexibilityPreset)
    : DEFAULT_VALUE;
}

export function FlexibilitySelect({
  label,
  name,
  defaultValue,
  hint,
  error,
  hideLabel = false,
  bare = false,
  required,
  className,
}: FlexibilitySelectProps) {
  const id = React.useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;

  const [value, setValue] = React.useState<FlexibilityValue>(toValue(defaultValue));

  const describedBy =
    [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(' ') || undefined;

  return (
    <div className={cn('flex flex-col', bare ? 'gap-0.5' : 'gap-1.5', className)}>
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

      <RadixSelect.Root
        name={name}
        value={value}
        onValueChange={(next) => setValue(next as FlexibilityValue)}
        required={required}
      >
        <RadixSelect.Trigger
          id={id}
          aria-describedby={describedBy}
          aria-invalid={error ? true : undefined}
          className={cn(
            'text-text flex w-full min-w-0 items-center justify-between gap-1.5 text-left text-[16px] outline-none sm:text-[14px]',
            'disabled:cursor-not-allowed disabled:opacity-70',
            'focus-visible:outline-accent-ink focus-visible:outline-2 focus-visible:outline-offset-2',
            bare
              ? 'h-7 truncate border-0 bg-transparent p-0'
              : cn(
                  'bg-surface-raised h-11 rounded-(--radius-control) border py-3 pr-3 pl-3',
                  error ? 'border-critical-500' : 'border-border-strong',
                ),
          )}
        >
          <span className="min-w-0 flex-1 truncate">
            <RadixSelect.Value>{labelFor(value)}</RadixSelect.Value>
          </span>
          <RadixSelect.Icon asChild>
            <Icon
              name="chevron-down"
              className={cn('text-dim shrink-0', bare ? 'size-3' : 'size-4')}
            />
          </RadixSelect.Icon>
        </RadixSelect.Trigger>

        <RadixSelect.Portal>
          <RadixSelect.Content
            position="popper"
            side="bottom"
            align="start"
            sideOffset={8}
            collisionPadding={12}
            className="voyagr-popover w-60"
          >
            <RadixSelect.Viewport className="flex flex-col gap-3">
              {GROUPS.map((group, index) => (
                <RadixSelect.Group key={group.heading}>
                  <RadixSelect.Label className="text-dim px-2 pb-1 text-[11px] font-medium tracking-[0.06em] uppercase">
                    {group.heading}
                  </RadixSelect.Label>
                  <div className="flex flex-col gap-0.5">
                    {group.options.map((option) => (
                      <RadixSelect.Item key={option} value={option} className="voyagr-select-item">
                        <RadixSelect.ItemText>{labelFor(option)}</RadixSelect.ItemText>
                        <RadixSelect.ItemIndicator className="text-accent-300 flex">
                          <Icon name="check" className="size-4" />
                        </RadixSelect.ItemIndicator>
                      </RadixSelect.Item>
                    ))}
                  </div>
                  {index < GROUPS.length - 1 ? (
                    <RadixSelect.Separator className="border-hairline mx-1 border-t" />
                  ) : null}
                </RadixSelect.Group>
              ))}
            </RadixSelect.Viewport>
          </RadixSelect.Content>
        </RadixSelect.Portal>
      </RadixSelect.Root>

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
}
