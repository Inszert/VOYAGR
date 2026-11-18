'use client';

import * as React from 'react';
import { Label } from 'radix-ui';
import { cn } from '@/lib/cn';
import { Icon } from '@/components/ui/icon';
import type { AirportSuggestion } from '@/search/destination-names';

/**
 * An airport field that suggests airports.
 *
 * A real `<input>` with a real `<label>`, so it submits inside the GET form,
 * restores from a URL and works with no JavaScript at all - exactly as the
 * plain field it replaces did. The suggestions are an enhancement on top: a
 * listbox that appears as you type and disappears when you are done.
 *
 * **It suggests for the word being typed, not the whole field.** These fields
 * take a list - "AYT, CHQ, SPU" - so typing "BU" after a comma has to match
 * "BUD" without the earlier codes getting in the way, and choosing one has to
 * replace that word rather than the line. Anything else would make the
 * suggestions useless in the field they are most needed in.
 *
 * Accessibility follows the combobox pattern: the input owns the listbox
 * through `aria-controls`, says whether it is open with `aria-expanded`,
 * points at the highlighted row with `aria-activedescendant`, and the arrow
 * keys, Enter, Tab and Escape all do what they do in a native one. Focus
 * never leaves the input, so a screen reader hears the field throughout.
 */

/** Fired on the input, bubbling, after a suggestion has been written into it. */
export const AIRPORT_PICKED_EVENT = 'voyagr:airport-picked';

export interface AirportInputProps {
  label: string;
  name: string;
  defaultValue?: string;
  /**
   * Shown only while the field is empty. A placeholder is never submitted, so
   * an empty field with a placeholder is an empty value, not that word.
   */
  placeholder?: string;
  hint?: string;
  error?: string;
  required?: boolean;
  /** Every airport the catalogue knows. Sent from the server. */
  airports: readonly AirportSuggestion[];
  /** How many suggestions to offer at once. */
  limit?: number;
  /** Drop the control's own border, for a segmented bar. */
  bare?: boolean;
  /**
   * Open above the field instead of below it, for a bar at the foot of a
   * clipped hero where a list below would be cut off. A fixed choice made by
   * the caller, never measured at run time: a list that flips depending on
   * the room left is what made it jump.
   */
  dropUp?: boolean;
}

/** The comma-separated word the cursor is in, and where it sits. */
function activeToken(value: string, caret: number): { text: string; start: number; end: number } {
  const start = value.lastIndexOf(',', Math.max(0, caret - 1)) + 1;
  const afterComma = value.indexOf(',', caret);
  const end = afterComma === -1 ? value.length : afterComma;

  return { text: value.slice(start, end).trim(), start, end };
}

function matches(
  airports: readonly AirportSuggestion[],
  term: string,
  limit: number,
): AirportSuggestion[] {
  const needle = term.trim().toUpperCase();
  if (needle.length === 0) return [];

  const byCode: AirportSuggestion[] = [];
  const byName: AirportSuggestion[] = [];
  const byWord: AirportSuggestion[] = [];
  const byAnywhere: AirportSuggestion[] = [];

  for (const airport of airports) {
    // A code prefix first, because somebody typing "BU" is nearly always
    // typing a code; a name match after, because somebody typing "buda" is
    // not, and both should find Budapest.
    if (airport.code.startsWith(needle)) {
      byCode.push(airport);
      continue;
    }

    const name = airport.name.toUpperCase();
    if (name.startsWith(needle)) {
      byName.push(airport);
      continue;
    }

    /*
     * Then any word of the airport's own name or its country.
     *
     * "Sur" finds Tenerife Sur, "Canary" is not in any name but "Santa Cruz"
     * and "Reina Sofia" are, and "Bolivia" finds La Paz. Matching only the
     * start of the city name meant an island airport whose city name is the
     * island's - and whose airport name is the useful part - was unreachable.
     */
    const haystack = `${name} ${(airport.detail ?? '').toUpperCase()} ${airport.country.toUpperCase()}`;
    if (haystack.split(/[\s/,.()-]+/).some((word) => word.startsWith(needle))) byWord.push(airport);
    else if (needle.length >= 3 && haystack.includes(needle)) byAnywhere.push(airport);
  }

  return [...byCode, ...byName, ...byWord, ...byAnywhere].slice(0, limit);
}

export function AirportInput({
  label,
  name,
  defaultValue = '',
  placeholder,
  hint,
  error,
  required,
  airports,
  limit = 8,
  bare = false,
  dropUp = false,
}: AirportInputProps) {
  const id = React.useId();
  const listId = `${id}-listbox`;
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;

  const inputRef = React.useRef<HTMLInputElement>(null);
  const [value, setValue] = React.useState(defaultValue);
  const [term, setTerm] = React.useState('');
  const [open, setOpen] = React.useState(false);
  const [active, setActive] = React.useState(0);

  /*
   * The rows are worked out from the deferred term. While a new list is being
   * built, the rows already on screen stay where they are, and the swap happens
   * as one update - never a frame where the panel is empty, shorter or gone.
   */
  const deferredTerm = React.useDeferredValue(term);
  const suggestions = React.useMemo(
    () => (open ? matches(airports, deferredTerm, limit) : []),
    [airports, deferredTerm, limit, open],
  );

  const describedBy =
    [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(' ') || undefined;

  const readToken = () => {
    const input = inputRef.current;
    if (!input) return { text: '', start: 0, end: 0 };
    return activeToken(input.value, input.selectionStart ?? input.value.length);
  };

  const choose = (airport: AirportSuggestion, keepFocus = true) => {
    const input = inputRef.current;
    if (!input) return;

    const { start, end } = readToken();
    // A space after the comma, because that is how the placeholder writes it
    // and how anybody types it.
    const before = input.value.slice(0, start);
    const after = input.value.slice(end);
    const spacer = before.length > 0 && !before.endsWith(' ') ? ' ' : '';
    const next = `${before}${spacer}${airport.code}${after}`;

    setValue(next);
    setOpen(false);
    setTerm('');

    // Put the caret after what was just chosen, so typing a comma and the
    // next code carries straight on.
    window.requestAnimationFrame(() => {
      const caret = before.length + spacer.length + airport.code.length;
      input.setSelectionRange(caret, caret);
      // Tab is leaving the field; pulling focus back would undo it.
      if (keepFocus) input.focus();
      // Tell the form a place was picked, so a live search applies at once
      // rather than waiting for the field to be left.
      input.dispatchEvent(new CustomEvent(AIRPORT_PICKED_EVENT, { bubbles: true }));
    });
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      setOpen(false);
      return;
    }

    if (!open || suggestions.length === 0) {
      if (event.key === 'ArrowDown') {
        setTerm(readToken().text);
        setOpen(true);
        setActive(0);
        event.preventDefault();
      }
      return;
    }

    if (event.key === 'ArrowDown') {
      setActive((current) => (current + 1) % suggestions.length);
      event.preventDefault();
    } else if (event.key === 'ArrowUp') {
      setActive((current) => (current - 1 + suggestions.length) % suggestions.length);
      event.preventDefault();
    } else if (event.key === 'Enter' || event.key === 'Tab') {
      const airport = suggestions[active];
      if (airport) {
        choose(airport, event.key !== 'Tab');
        // Enter inside a form would submit it; the first Enter is for the
        // suggestion, and the next one submits as usual.
        if (event.key === 'Enter') event.preventDefault();
      }
    }
  };

  return (
    <div className={cn('relative flex flex-col', bare ? 'gap-0.5' : 'gap-1.5')}>
      <Label.Root
        htmlFor={id}
        className={cn(
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
      </Label.Root>

      <div className="relative">
        <input
          ref={inputRef}
          id={id}
          name={name}
          value={value}
          placeholder={placeholder}
          required={required}
          autoComplete="off"
          spellCheck={false}
          role="combobox"
          aria-expanded={open && suggestions.length > 0}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open && suggestions.length > 0 ? `${listId}-${active}` : undefined}
          aria-describedby={describedBy}
          aria-invalid={error ? true : undefined}
          onChange={(event) => {
            setValue(event.target.value);
            const token = activeToken(event.target.value, event.target.selectionStart ?? 0);
            setTerm(token.text);
            setActive(0);
            setOpen(token.text.length > 0);
          }}
          onKeyDown={onKeyDown}
          // "anywhere" is a stand-in for a place, not text to type after:
          // focusing it selects it, so the first letters typed replace it
          // instead of becoming "LISanywhere", which is no airport.
          onFocus={(event) => {
            if (event.currentTarget.value.trim().toLowerCase() === 'anywhere') {
              event.currentTarget.select();
            }
          }}
          // A blur that lands on a suggestion must not close the list before
          // the click registers, so the close waits a frame.
          onBlur={() => window.setTimeout(() => setOpen(false), 120)}
          className={cn(
            'text-text w-full min-w-0 text-[16px] sm:text-[14px]',
            'placeholder:text-dim',
            /*
             * An ellipsis, not a guillotine.
             *
             * The destinations field defaults to every airport the catalogue
             * can price, and a fixed-width cell used to cut that list off
             * mid-code - "AYT, CHQ, LCA" with no sign there was more. The
             * value is unchanged and still submits in full; what changed is
             * that the field now says out loud that it is showing part of it.
             */
            bare
              ? 'h-7 truncate border-0 bg-transparent p-0 pr-4 focus:outline-none'
              : cn(
                  'bg-surface-raised h-11 rounded-(--radius-control) border py-3 pr-9 pl-3',
                  error ? 'border-critical-500' : 'border-border-strong',
                ),
          )}
        />

        {/*
          Says, without a word, that this field offers suggestions rather than
          only accepting free text - the one thing that told a reader apart
          from a plain field before was typing into it and watching a list
          appear. Decorative: `Icon` is already `aria-hidden`, and the
          combobox role and `aria-expanded` on the input are what actually
          carry this to assistive technology.
        */}
        <Icon
          name="chevron-down"
          className={cn(
            'text-dim pointer-events-none absolute top-1/2 right-0 -translate-y-1/2',
            bare ? 'size-3' : 'mr-3 size-4',
          )}
        />

        {/*
          Anchored to the field, not to the column around it. It sits under the
          input's own box, so it is exactly the field's width and never depends
          on how tall the label above has come out. Always rendered, so the
          listbox the input points at exists even when it is empty - a control
          referring to an element that is not there is a broken reference to a
          screen reader. Absolute, so opening it moves nothing beneath it.
        */}
        <ul
          id={listId}
          role="listbox"
          aria-label={`Airport suggestions for ${label.toLowerCase()}`}
          className={cn(
            // At least the field's width, wider when the field is narrow, so a
            // name is read rather than cut to three letters.
            'border-border-strong bg-panel shadow-floating absolute left-0 z-30',
            dropUp ? 'bottom-full mb-2' : 'top-full mt-1',
            'w-max max-w-[min(24rem,calc(100vw-2rem))] min-w-full',
            'max-h-80 overflow-auto overscroll-contain rounded-(--radius-control) border py-1',
            open && suggestions.length > 0 ? '' : 'hidden',
          )}
        >
          {suggestions.map((airport, index) => {
            const highlighted = index === active;
            return (
              <li
                key={airport.code}
                id={`${listId}-${index}`}
                role="option"
                aria-selected={highlighted}
                // `onMouseDown` rather than `onClick`: the blur that a click
                // causes would otherwise close the list before the click lands.
                onMouseDown={(event) => {
                  event.preventDefault();
                  choose(airport);
                }}
                onMouseEnter={() => setActive(index)}
                className={cn(
                  'flex min-h-11 cursor-pointer items-center gap-3 px-3 py-2 text-sm',
                  highlighted ? 'bg-surface-sunken' : '',
                )}
              >
                <span className="text-ink w-9 shrink-0 font-semibold tabular-nums">
                  {airport.code}
                </span>
                <span className="flex min-w-0 flex-col">
                  {/* Bold as well as shaded, so the highlighted row reads without colour. */}
                  <span
                    className={cn(
                      'text-ink truncate',
                      highlighted ? 'font-semibold' : 'font-normal',
                    )}
                  >
                    {airport.name}
                  </span>
                  {/* The airport's own name, which is what separates two airports in one place. */}
                  <span className="text-ink-muted truncate text-xs">
                    {airport.detail && airport.detail !== airport.name
                      ? `${airport.detail} · ${airport.country}`
                      : airport.country}
                  </span>
                </span>
              </li>
            );
          })}
        </ul>
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
}
