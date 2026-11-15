'use client';

import * as React from 'react';
import { Icon } from '@/components/ui';

/**
 * Previous / next for a horizontal rail.
 *
 * Plain buttons that move a scroll container by most of its width. They are
 * for a pointer: a touch screen scrolls with a thumb, and `home.css` hides
 * them there. They add nothing a keyboard did not already have - the cards
 * are links, and focusing one scrolls it into view - so they are a
 * convenience, and the rail is complete without them.
 *
 * Each is disabled at its end, which keeps it in the tab order's way only
 * while it can do something.
 */

export interface ScrollButtonsProps {
  /** The id of the scroll container these drive. */
  targetId: string;
  /** What is being scrolled, for the names: "Previous destinations". */
  noun: string;
}

export function ScrollButtons({ targetId, noun }: ScrollButtonsProps) {
  const [edge, setEdge] = React.useState({ start: true, end: false });

  React.useEffect(() => {
    const target = document.getElementById(targetId);
    if (!target) return;

    const update = () => {
      setEdge({
        start: target.scrollLeft <= 1,
        end: target.scrollLeft + target.clientWidth >= target.scrollWidth - 1,
      });
    };

    update();
    target.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);

    return () => {
      target.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
    };
  }, [targetId]);

  const move = (direction: 1 | -1) => {
    const target = document.getElementById(targetId);
    if (!target) return;

    target.scrollBy({
      left: direction * Math.max(target.clientWidth * 0.8, 240),
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
    });
  };

  const button =
    'border-border-strong bg-surface-raised text-ink hover:bg-surface-sunken disabled:text-dim grid size-11 place-items-center rounded-full border disabled:cursor-not-allowed disabled:opacity-60';

  return (
    <div className="home-rail-nav flex items-center gap-2">
      <button
        type="button"
        aria-label={`Previous ${noun}`}
        disabled={edge.start}
        onClick={() => move(-1)}
        className={button}
      >
        <Icon name="chevron-left" size={1} aria-hidden />
      </button>
      <button
        type="button"
        aria-label={`Next ${noun}`}
        disabled={edge.end}
        onClick={() => move(1)}
        className={button}
      >
        <Icon name="chevron-right" size={1} aria-hidden />
      </button>
    </div>
  );
}
