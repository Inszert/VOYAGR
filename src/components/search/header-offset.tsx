'use client';

import * as React from 'react';

/**
 * Publishes the site header's height as `--voyagr-header-h`.
 *
 * A sticky toolbar has to sit exactly under the header, and the header is not
 * a fixed height: on a phone its navigation wraps onto a second line. So it is
 * measured, and re-measured when it changes, instead of being written down.
 * Renders nothing.
 */
export function HeaderOffset() {
  React.useEffect(() => {
    const header = document.querySelector('header');
    if (!header) return;

    const root = document.documentElement;
    const publish = () => root.style.setProperty('--voyagr-header-h', `${header.offsetHeight}px`);

    publish();
    const observer = new ResizeObserver(publish);
    observer.observe(header);

    return () => {
      observer.disconnect();
      root.style.removeProperty('--voyagr-header-h');
    };
  }, []);

  return null;
}
