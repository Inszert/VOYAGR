'use client';

import * as React from 'react';

/**
 * Tells the hero where it really starts.
 *
 * The hero is pulled up under the site header with a fixed negative margin, on
 * the assumption that the header is 72px tall. It is not always: on a phone it
 * wraps to two rows. The hero's top edge is therefore wherever the header
 * ends minus that 72px, and everything sized from "the screen" - its height,
 * where the planet's top sits - has to subtract it. This measures the header,
 * not a guess, and writes the answer as `--hero-top` on the hero.
 *
 * It renders nothing. Before it runs, the CSS falls back to values that are
 * right for a desktop and close for a phone.
 */
export function HeroMetrics() {
  const marker = React.useRef<HTMLSpanElement>(null);

  React.useEffect(() => {
    const hero = marker.current?.parentElement;
    const header = document.querySelector('header');
    if (!hero) return;

    const measure = () => {
      // Where the hero begins on the page, at the top of the page.
      const top = hero.getBoundingClientRect().top + window.scrollY;
      hero.style.setProperty('--hero-top', `${Math.max(0, Math.round(top))}px`);
    };

    measure();

    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    if (header) observer?.observe(header);
    window.addEventListener('resize', measure);

    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, []);

  return <span ref={marker} hidden />;
}
