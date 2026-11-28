import type Link from 'next/link';
import type { redirect } from 'next/navigation';
import type { ComponentProps } from 'react';

/** What `redirect` and the router methods accept. With typed routes on, a known route. */
export type RuntimeRedirect = Parameters<typeof redirect>[0];

/** What a `Link` `href` accepts. With typed routes on, a known route or a URL object. */
export type RuntimeHref = ComponentProps<typeof Link>['href'];

/**
 * Typed routes cannot see a path assembled at runtime. This returns it as the
 * type `redirect` (and `router.push`/`replace`) accept. The caller MUST have
 * built the path from a fixed base or a validated value (see `redirectTarget`
 * in `@/auth/return-to` for untrusted input); nothing is checked here.
 */
export function asRedirect(path: string): RuntimeRedirect {
  return path as RuntimeRedirect;
}

/**
 * The same, for a `Link` `href`. The caller MUST have built the path from a
 * fixed base or a validated value; nothing is checked here.
 */
export function asHref(path: string): RuntimeHref {
  return path as RuntimeHref;
}
