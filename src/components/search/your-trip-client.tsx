'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Collapsible as RadixCollapsible } from 'radix-ui';
import { Icon, Sheet, SheetClose, SheetContent, SheetTrigger } from '@/components/ui';
import { format, money } from '@/core/money';
import { cn } from '@/lib/cn';

/**
 * The parts of "Your trip" that move: changing a leg, the total that follows
 * it, the hotel's photographs, and the phone's summary bar.
 *
 * **Nothing here computes a price.** Every figure arrives as a string the
 * server formatted from the engine's `Money`. The one number this file holds
 * is the total in minor units, and only so the figure can be *counted* from
 * the old total to the new one for 420ms; where it lands is the engine's
 * total, formatted exactly as the server formats it.
 */

// --- Changing a leg ----------------------------------------------------------

export interface ChangeOption {
  /** The offer id, carried in the URL as the existing swap parameter. */
  readonly id: string;
  /** Where choosing it goes: the same page, rebuilt with it. */
  readonly href: string;
  /** "06:10 — 07:55 · 1h 45m · Direct". */
  readonly title: string;
  /** Further facts, one short line each. */
  readonly lines: readonly string[];
  /** "+ €24.00", "− €12.40", "same price": against the current choice. */
  readonly delta: string;
  readonly deltaTone: 'more' | 'less' | 'same';
  /** "trip €443.56": the whole trip with this choice. */
  readonly tripTotal: string;
  readonly isCurrent: boolean;
  /** False when the trip with it falls outside what was asked for. */
  readonly eligible: boolean;
  /** Ordering keys. Only ever compared, never shown or added. */
  readonly order: Readonly<Record<string, number | null>>;
}

export interface ChangeSort {
  readonly id: string;
  readonly label: string;
}

export interface LegChangerProps {
  /** "outbound flight", "stay": named in the trigger and the list. */
  readonly what: string;
  /** The card's own content. */
  readonly children: React.ReactNode;
  readonly options: readonly ChangeOption[];
  readonly sorts: readonly ChangeSort[];
  /** "No other flights for these dates". */
  readonly emptyText: string;
  /** Where the empty state sends somebody: the calendar. */
  readonly emptyHref: string;
  /** The URL parameter the radios set, for the form that works without script. */
  readonly param: string;
  readonly className?: string;
}

const VISIBLE = 6;

export function LegChanger({
  what,
  children,
  options,
  sorts,
  emptyText,
  emptyHref,
  param,
  className,
}: LegChangerProps) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [sort, setSort] = React.useState(sorts[0]?.id ?? '');
  const [all, setAll] = React.useState(false);
  const [pending, startTransition] = React.useTransition();
  // What was just picked, against what was current when it was picked: once
  // a new page arrives with a different current choice, the server's wins.
  const [picked, setPicked] = React.useState<{ id: string; over: string | null } | null>(null);
  const listId = React.useId();
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const listRef = React.useRef<HTMLUListElement>(null);
  // The radio that had focus when it was chosen. A new page rebuilds the list
  // (and a reorder moves its nodes), and a keyboard user must not be dropped
  // onto the page body each time they arrow to the next choice.
  const refocus = React.useRef<string | null>(null);

  const current = options.find((option) => option.isCurrent)?.id ?? null;
  const chosen = picked && picked.over === current ? picked.id : null;

  const sorted = React.useMemo(() => {
    const key = sort;
    return [...options].sort((a, b) => {
      const x = a.order[key] ?? Number.POSITIVE_INFINITY;
      const y = b.order[key] ?? Number.POSITIVE_INFINITY;
      return x - y || (a.order.cheapest ?? 0) - (b.order.cheapest ?? 0);
    });
  }, [options, sort]);

  const shown = all ? sorted : sorted.slice(0, VISIBLE);
  const others = options.filter((option) => !option.isCurrent).length;

  // The form's fixed fields, from the first link: everything but this choice.
  const hidden = React.useMemo(() => {
    const first = options[0];
    if (!first) return { action: '', fields: [] as [string, string][] };
    const url = new URL(first.href, 'http://local');
    return {
      action: url.pathname,
      fields: [...url.searchParams.entries()].filter(([key]) => key !== param),
    };
  }, [options, param]);

  // Once the new page has arrived: if the choice cost the user their place, give it back.
  React.useEffect(() => {
    const id = refocus.current;
    if (!id || pending) return;
    refocus.current = null;
    const active = document.activeElement;
    if (active && active !== document.body) return;
    const radio = [
      ...(listRef.current?.querySelectorAll<HTMLInputElement>('input[type="radio"]') ?? []),
    ].find((input) => input.value === id);
    radio?.focus({ preventScroll: true });
  }, [pending, current]);

  const choose = (option: ChangeOption) => {
    if (option.isCurrent) return;
    refocus.current = document.activeElement instanceof HTMLInputElement ? option.id : null;
    setPicked({ id: option.id, over: current });
    startTransition(() => router.push(option.href, { scroll: false }));
  };

  return (
    <RadixCollapsible.Root
      open={open}
      onOpenChange={setOpen}
      className={className}
      onKeyDown={(event) => {
        // Escape folds the panel and hands focus back to its button.
        if (event.key !== 'Escape' || !open) return;
        event.stopPropagation();
        setOpen(false);
        triggerRef.current?.focus();
      }}
    >
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">{children}</div>
        <RadixCollapsible.Trigger
          ref={triggerRef}
          aria-label={`${open ? 'Done changing the' : 'Change'} ${what}`}
          className={cn(
            'text-ink hover:bg-surface-sunken inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-(--radius-control) px-3 text-sm font-medium',
            'ease-standard duration-quick transition-colors',
            'focus-visible:outline-accent-to focus-visible:outline-2 focus-visible:outline-offset-2',
          )}
        >
          {open ? 'Done' : 'Change'}
          <Icon
            name="chevron-down"
            size={0.9}
            aria-hidden="true"
            className={cn(
              'ease-standard duration-settled transition-transform',
              open && 'rotate-180',
            )}
          />
        </RadixCollapsible.Trigger>
      </div>

      <RadixCollapsible.Content className="voyagr-leg-content">
        <div className="border-border mt-4 flex flex-col gap-3 border-t pt-4">
          {others === 0 ? (
            <p className="text-ink-muted text-sm">
              {emptyText}.{' '}
              <a
                href={emptyHref}
                className="text-tint-ink inline-flex min-h-11 items-center font-medium underline underline-offset-4"
              >
                Try other dates
              </a>
            </p>
          ) : (
            <>
              <div
                role="group"
                aria-label={`Sort the ${what} options`}
                className="flex flex-wrap gap-1.5"
              >
                {sorts.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    aria-pressed={sort === option.id}
                    onClick={() => setSort(option.id)}
                    className={cn(
                      'inline-flex min-h-11 items-center rounded-(--radius-pill) border px-3.5 text-sm',
                      'ease-standard duration-quick transition-colors',
                      'focus-visible:outline-accent-to focus-visible:outline-2 focus-visible:outline-offset-2',
                      sort === option.id
                        ? 'border-ink text-ink font-medium'
                        : 'border-border text-ink-muted hover:text-ink hover:border-border-strong',
                    )}
                  >
                    {option.label}
                  </button>
                ))}
              </div>

              <form action={hidden.action} method="get">
                {hidden.fields.map(([key, value]) => (
                  <input key={key} type="hidden" name={key} value={value} />
                ))}
                <fieldset aria-busy={pending || undefined}>
                  <legend className="sr-only">Choose the {what}</legend>
                  <ul
                    id={listId}
                    ref={listRef}
                    className={cn(
                      'duration-quick flex flex-col gap-1.5 transition-opacity',
                      pending && 'opacity-60',
                    )}
                  >
                    {shown.map((option) => {
                      const checked = chosen ? chosen === option.id : option.isCurrent;
                      return (
                        <li key={option.id}>
                          <label
                            className={cn(
                              'flex cursor-pointer items-start gap-3 rounded-(--radius-card) border p-3',
                              'ease-standard duration-quick transition-colors',
                              'has-[:focus-visible]:outline-accent-to has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2',
                              checked
                                ? 'border-ink bg-surface-sunken'
                                : 'border-border hover:border-border-strong',
                            )}
                          >
                            <input
                              type="radio"
                              name={param}
                              value={option.id}
                              checked={checked}
                              onChange={() => choose(option)}
                              className="accent-ink mt-1 size-4 shrink-0"
                            />
                            <span className="min-w-0 flex-1">
                              <span className="text-ink block text-sm font-medium tabular-nums">
                                {option.title}
                              </span>
                              {option.lines.map((line) => (
                                <span
                                  key={line}
                                  className="text-ink-muted block text-xs tabular-nums"
                                >
                                  {line}
                                </span>
                              ))}
                              {option.isCurrent ? (
                                <span className="text-ink mt-1 inline-flex items-center gap-1 text-xs font-medium">
                                  <Icon name="check" size={0.85} aria-hidden="true" />
                                  Selected
                                </span>
                              ) : null}
                              {option.eligible ? null : (
                                <span className="text-critical-ink mt-1 block text-xs">
                                  Outside what you asked for
                                </span>
                              )}
                            </span>
                            <span className="flex shrink-0 flex-col items-end text-right">
                              <span
                                className={cn(
                                  'text-sm font-medium tabular-nums',
                                  option.deltaTone === 'less'
                                    ? 'text-positive-ink'
                                    : 'text-ink-muted',
                                )}
                              >
                                {option.isCurrent ? 'current' : option.delta}
                              </span>
                              <span className="text-dim text-xs tabular-nums">
                                {option.tripTotal}
                              </span>
                            </span>
                          </label>
                        </li>
                      );
                    })}
                  </ul>
                </fieldset>
                <noscript>
                  <button
                    type="submit"
                    className="text-tint-ink mt-2 min-h-11 text-sm font-medium underline"
                  >
                    Use the chosen {what}
                  </button>
                </noscript>
              </form>

              {sorted.length > VISIBLE ? (
                <button
                  type="button"
                  aria-controls={listId}
                  aria-expanded={all}
                  onClick={() => setAll((value) => !value)}
                  className="text-tint-ink inline-flex min-h-11 w-fit items-center text-sm font-medium underline-offset-4 hover:underline"
                >
                  {all ? 'Show fewer' : `Show ${sorted.length - VISIBLE} more`}
                </button>
              ) : null}
            </>
          )}
        </div>
      </RadixCollapsible.Content>
    </RadixCollapsible.Root>
  );
}

// --- The total ----------------------------------------------------------------

export interface TripTotalProps {
  /** The engine's total, in minor units: only to count from the old figure. */
  readonly amountMinor: number;
  readonly currency: string;
  /** The same total as the server formatted it: where the count lands. */
  readonly formatted: string;
  /** "for 2 travellers", appended to the announcement. */
  readonly basis: string;
  /** False on a second copy of the same total, so a change is announced once. */
  readonly announce?: boolean;
  readonly className?: string;
}

const COUNT_MS = 420;

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
  );
}

/**
 * The trip total, counting from the last figure to the new one.
 *
 * In-between figures are on screen for under half a second and are never the
 * figure anybody acts on; the last frame is always `formatted`, the server's
 * own string. Reduced motion: the number just changes. The change is
 * announced politely, once, in words.
 */
export function TripTotal({
  amountMinor,
  currency,
  formatted,
  basis,
  announce = true,
  className,
}: TripTotalProps) {
  // The previous total, kept in state and compared during render, so a new
  // figure starts the count without an effect setting state.
  const [last, setLast] = React.useState(amountMinor);
  const [from, setFrom] = React.useState<number | null>(null);
  const [announcement, setAnnouncement] = React.useState('');
  const [frame, setFrame] = React.useState<string | null>(null);

  if (amountMinor !== last) {
    setLast(amountMinor);
    setFrom(last);
    setFrame(null);
    if (announce) setAnnouncement(`Trip total is now ${formatted} ${basis}`);
  }

  React.useEffect(() => {
    if (from === null || from === amountMinor || prefersReducedMotion()) return;

    let id = 0;
    const started = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - started) / COUNT_MS);
      if (t >= 1) {
        setFrame(null);
        return;
      }
      // --ease-out-quart
      const eased = 1 - (1 - t) ** 4;
      setFrame(format(money(Math.round(from + (amountMinor - from) * eased), currency)));
      id = requestAnimationFrame(step);
    };
    id = requestAnimationFrame(step);
    return () => cancelAnimationFrame(id);
  }, [from, amountMinor, currency]);

  // The last frame is always the server's own string.
  const shown = frame ?? formatted;

  return (
    <>
      <span
        className={cn('inline-block tabular-nums', className)}
        // Wide enough for the final figure, so counting moves nothing beside it.
        style={{ minWidth: `${formatted.length}ch` }}
      >
        {shown}
      </span>
      {announce ? (
        <span className="sr-only" aria-live="polite" aria-atomic="true">
          {announcement}
        </span>
      ) : null}
    </>
  );
}

// --- The hotel's photographs --------------------------------------------------

export interface HotelGalleryProps {
  readonly name: string;
  readonly photos: readonly string[];
  readonly className?: string;
}

/**
 * Up to five of the provider's own photographs, a swipe at a time.
 *
 * Scroll-snap does the moving, so touch, trackpad and the keyboard (the strip
 * takes focus; the arrow keys scroll it) all work without a carousel script.
 * The dots and the counter follow the scroll. With no photographs this is a
 * quiet tile with a bed, never a picture of some other building.
 */
export function HotelGallery({ name, photos, className }: HotelGalleryProps) {
  const list = photos.slice(0, 5);
  const strip = React.useRef<HTMLDivElement>(null);
  const [index, setIndex] = React.useState(0);

  const onScroll = () => {
    const element = strip.current;
    if (!element || element.clientWidth === 0) return;
    setIndex(Math.round(element.scrollLeft / element.clientWidth));
  };

  if (list.length === 0) {
    return (
      <div
        role="img"
        aria-label={`No photographs of ${name} were provided`}
        className={cn(
          'bg-surface-sunken text-dim grid place-items-center rounded-(--radius-control)',
          className,
        )}
      >
        <Icon name="bed" size={2} aria-hidden="true" />
      </div>
    );
  }

  return (
    <div className={cn('relative overflow-hidden rounded-(--radius-control)', className)}>
      <div
        ref={strip}
        onScroll={onScroll}
        tabIndex={0}
        role="group"
        aria-roledescription="gallery"
        aria-label={`Photographs of ${name}`}
        className="voyagr-gallery focus-visible:outline-accent-to flex h-full w-full overflow-x-auto focus-visible:outline-2 focus-visible:outline-offset-2"
      >
        {list.map((url, photo) => (
          // eslint-disable-next-line @next/next/no-img-element -- a provider's own URL, not ours to optimise
          <img
            key={url}
            src={url}
            alt={`${name}, photo ${photo + 1} of ${list.length}`}
            loading={photo === 0 ? 'eager' : 'lazy'}
            className="h-full w-full shrink-0 snap-start object-cover"
          />
        ))}
      </div>
      {list.length > 1 ? (
        <>
          <span
            aria-hidden="true"
            className="absolute top-2 right-2 rounded-(--radius-pill) bg-black/60 px-2 py-0.5 text-[11px] text-white tabular-nums"
          >
            {index + 1} / {list.length}
          </span>
          <span
            aria-hidden="true"
            className="absolute inset-x-0 bottom-2 flex justify-center gap-1.5"
          >
            {list.map((url, dot) => (
              <span
                key={url}
                className={cn('size-1.5 rounded-full', dot === index ? 'bg-white' : 'bg-white/45')}
              />
            ))}
          </span>
        </>
      ) : null}
    </div>
  );
}

// --- The phone's summary bar --------------------------------------------------

export interface SummaryBarProps {
  /** The element whose presence on screen shows the bar. */
  readonly watchId: string;
  readonly total: TripTotalProps;
  /** "€209.78 per person". */
  readonly perPerson: string;
  /** The primary action, already built: a link to book the flights. */
  readonly action: React.ReactNode;
  /** The whole summary panel, shown in the sheet. */
  readonly panel: React.ReactNode;
}

/**
 * Below 1024px the summary is a 64px bar pinned to the bottom of the screen
 * while "Your trip" is on it: the total and per person on the left, the
 * primary action on the right. Tapping the total opens the full panel as a
 * sheet (Radix Dialog: focus is trapped and returned, Escape closes).
 */
export function SummaryBar({ watchId, total, perPerson, action, panel }: SummaryBarProps) {
  const [visible, setVisible] = React.useState(false);

  React.useEffect(() => {
    const target = document.getElementById(watchId);
    if (!target || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(
      ([entry]) => setVisible(entry?.isIntersecting ?? false),
      {
        rootMargin: '0px 0px -40% 0px',
      },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [watchId]);

  return (
    <div
      // Hidden, not removed, while the trip is off screen: it keeps its state.
      hidden={!visible}
      className="border-border-strong bg-surface-raised fixed inset-x-0 bottom-0 z-30 border-t pb-[env(safe-area-inset-bottom)] lg:hidden"
    >
      <div className="mx-auto flex h-16 max-w-3xl items-center justify-between gap-3 px-4">
        <Sheet>
          <SheetTrigger className="focus-visible:outline-accent-to flex min-h-11 min-w-0 flex-col items-start text-left focus-visible:outline-2 focus-visible:outline-offset-2">
            <span className="text-ink text-lg leading-tight font-semibold">
              <TripTotal {...total} announce={false} />
            </span>
            <span className="text-ink-muted text-xs tabular-nums">
              {perPerson} · <span className="underline underline-offset-2">Details</span>
            </span>
          </SheetTrigger>
          <SheetContent title="Your trip, in total" side="bottom" className="p-5 pb-8">
            <div className="mb-3 flex justify-end">
              <SheetClose className="text-ink-muted hover:text-ink focus-visible:outline-accent-to inline-flex min-h-11 items-center px-2 text-sm font-medium focus-visible:outline-2">
                Close
              </SheetClose>
            </div>
            {panel}
          </SheetContent>
        </Sheet>
        <div className="shrink-0">{action}</div>
      </div>
    </div>
  );
}
