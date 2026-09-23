'use client';

import * as React from 'react';
import { Icon } from '@/components/ui';

/**
 * A scrolling row with something to press.
 *
 * The lenses are ten links and the column they sit in fits about five, so the
 * row has always scrolled. What it did not have was any sign that it scrolled:
 * the overflow faded out and the fifth word simply dissolved, which reads as a
 * rendering fault rather than as an invitation.
 *
 * So the row keeps its own scroll - a trackpad, a touch drag and the tab key
 * all still work, and always did - and gains two buttons for the people using
 * none of those. They disable themselves at each end rather than disappearing,
 * because a control that vanishes when you reach the edge of a list is a
 * control that moves under the pointer.
 *
 * The fade stays, on the side that can still be scrolled towards, so the row
 * says which way there is more of it even while the buttons are out of reach
 * at the far end of a phone.
 */

/** How far one press moves the row: most of a screenful, not all of it. */
const PAGE = 0.8;

export function LensSlider({ children }: { children: React.ReactNode }) {
  const track = React.useRef<HTMLDivElement>(null);
  const [atStart, setAtStart] = React.useState(true);
  const [atEnd, setAtEnd] = React.useState(true);
  /*
   * Whether the buttons can actually do anything yet.
   *
   * Server-rendered, they are two controls that scroll nothing: the handler
   * that moves the row only exists once this has hydrated. They start
   * disabled - which is also their correct state at either end of the row -
   * and the row says out loud when it has come alive, which is a thing a
   * person can see and a test can wait for instead of guessing at a delay.
   */
  const [ready, setReady] = React.useState(false);

  React.useEffect(() => {
    const element = track.current;
    if (!element) return;

    const update = () => {
      // A pixel of slack: a scroll position is fractional once the browser
      // has applied a smooth scroll, and `>=` on an exact total never fires.
      setAtStart(element.scrollLeft <= 1);
      setAtEnd(element.scrollLeft + element.clientWidth >= element.scrollWidth - 1);
    };

    update();
    setReady(true);
    element.addEventListener('scroll', update, { passive: true });

    /*
     * The row is inside a column that changes width with the viewport, and
     * whether it overflows at all changes with it. Guarded because this runs
     * in a component-test environment that has no `ResizeObserver`: without
     * the guard the whole panel fails to render there, which is a test
     * telling the truth about a browser that does not have it either.
     */
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(update) : null;
    observer?.observe(element);

    return () => {
      element.removeEventListener('scroll', update);
      observer?.disconnect();
    };
  }, []);

  const page = (direction: 1 | -1) => {
    const element = track.current;
    if (!element) return;

    element.scrollBy({
      left: direction * element.clientWidth * PAGE,
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
    });
  };

  const button =
    'border-hairline text-muted hover:text-text disabled:opacity-30 focus-visible:outline-accent-ink ease-standard duration-quick grid size-7 shrink-0 place-items-center rounded-full border transition-colors disabled:hover:text-(--color-muted)';

  return (
    <div className="flex items-center gap-1.5">
      <button
        type="button"
        onClick={() => page(-1)}
        disabled={!ready || atStart}
        className={button}
      >
        <Icon name="arrow-right" size={1} className="size-[14px] rotate-180" />
        <span className="sr-only">Show the earlier kinds of trip</span>
      </button>

      <div
        ref={track}
        data-ready={ready ? 'true' : undefined}
        data-start={atStart ? 'true' : undefined}
        data-end={atEnd ? 'true' : undefined}
        className="voyagr-lenses min-w-0 flex-1 [scrollbar-width:none] overflow-x-auto"
      >
        {children}
      </div>

      <button type="button" onClick={() => page(1)} disabled={!ready || atEnd} className={button}>
        <Icon name="arrow-right" size={1} className="size-[14px]" />
        <span className="sr-only">Show the later kinds of trip</span>
      </button>
    </div>
  );
}
