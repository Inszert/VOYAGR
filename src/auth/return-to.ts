/**
 * Where to send someone after they sign in or create an account.
 *
 * The value arrives from a query string and a hidden form field, so it is
 * attacker-controlled. Only a same-origin relative path is accepted: one
 * leading `/`, not `//` (protocol-relative), no backslash (browsers treat it
 * as `/`), no CR/LF, and no scheme anywhere in the first segment. Anything
 * else is `null` and the caller falls back to its default.
 */

import type { redirect } from 'next/navigation';

const MAX_LENGTH = 512;

export function safeNextPath(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  if (value.length === 0 || value.length > MAX_LENGTH) return null;
  if (value[0] !== '/' || value[1] === '/') return null;
  if (value.includes('\\')) return null;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(value)) return null;
  // A scheme can only hide in the first segment; reject `:` there.
  const firstSegment = value.slice(1).split(/[/?#]/, 1)[0] ?? '';
  if (firstSegment.includes(':')) return null;
  return value;
}

/**
 * The argument `redirect` accepts. With typed routes on, Next types it as a
 * known route, which a runtime path can never be - so the type is taken from
 * `redirect` itself rather than hand-written.
 */
type RedirectTarget = Parameters<typeof redirect>[0];

/**
 * Where a redirect should go: the caller's `next` if it passes `safeNextPath`,
 * otherwise `fallback`. The check above is what makes the cast below safe; the
 * type system cannot see that a query-string path was checked.
 */
export function redirectTarget(value: unknown, fallback: string): RedirectTarget {
  return (safeNextPath(value) ?? fallback) as RedirectTarget;
}
