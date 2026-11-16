'use client';

import * as React from 'react';

/**
 * Whether a media query matches, known only after mount.
 *
 * Returns `null` until then (and where `matchMedia` does not exist, as in a
 * test environment), so a caller can tell "not yet known" from "no".
 */
export function useMedia(query: string): boolean | null {
  const [matches, setMatches] = React.useState<boolean | null>(null);

  React.useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const list = window.matchMedia(query);
    const read = () => setMatches(list.matches);
    read();
    list.addEventListener('change', read);

    return () => list.removeEventListener('change', read);
  }, [query]);

  return matches;
}

export const REDUCED_MOTION = '(prefers-reduced-motion: reduce)';

/** `null` while unknown. Motion is only ever started once this is `false`. */
export function useReducedMotion(): boolean | null {
  return useMedia(REDUCED_MOTION);
}
