/**
 * The Content-Security-Policy for one request.
 *
 * Pure, so the nonce dance in `src/proxy.ts` is unit-testable and the third
 * party's origin appears in exactly one place: the `driveOrigin` argument, which
 * is non-null only for a request that carries the accepted consent cookie.
 * Every other request gets a policy that does not name it at all.
 */

export interface CspInput {
  readonly nonce: string;
  readonly isDev: boolean;
  /** The partner script's origin, only when this visitor accepted it. */
  readonly driveOrigin: string | null;
}

export function buildContentSecurityPolicy({ nonce, isDev, driveOrigin }: CspInput): string {
  const drive = driveOrigin ? ` ${driveOrigin}` : '';

  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}'${isDev ? " 'unsafe-eval'" : ''}${drive}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' blob: data:",
    "font-src 'self' data:",
    `connect-src 'self'${isDev ? ' ws: http://localhost:*' : ''}${drive}`,
    "worker-src 'self'",
    "manifest-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    'upgrade-insecure-requests',
  ].join('; ');
}
