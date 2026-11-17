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

/**
 * What the accepted Travelpayouts Drive script needs beyond its own origin: it
 * creates a blob worker, loads a stylesheet from its origin and checks auth
 * against travelpayouts.com. Added only when `driveOrigin` is set, i.e. only
 * for an accepted visitor on real production. See docs/security.md.
 */
const DRIVE_AUTH_ORIGIN = 'https://www.travelpayouts.com';

/**
 * Hotel photographs come from the LiteAPI content CDN. Exact https hostnames, no
 * wildcard. `IMAGE_HOSTS_IN_CSP` in src/components/stays/stay-photo.tsx must be
 * this same list: change them together.
 */
export const IMAGE_HOSTS: readonly string[] = ['static.cupid.travel'];

export function buildContentSecurityPolicy({ nonce, isDev, driveOrigin }: CspInput): string {
  const drive = driveOrigin ? ` ${driveOrigin}` : '';
  const driveStyle = driveOrigin ? ` ${driveOrigin}` : '';
  const driveConnect = driveOrigin ? ` ${DRIVE_AUTH_ORIGIN}` : '';
  const driveWorker = driveOrigin ? ' blob:' : '';

  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}'${isDev ? " 'unsafe-eval'" : ''}${drive}`,
    `style-src 'self' 'unsafe-inline'${driveStyle}`,
    `img-src 'self' blob: data: ${IMAGE_HOSTS.map((h) => `https://${h}`).join(' ')}`,
    "font-src 'self' data:",
    `connect-src 'self'${isDev ? ' ws: http://localhost:*' : ''}${drive}${driveConnect}`,
    `worker-src 'self'${driveWorker}`,
    "manifest-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    'upgrade-insecure-requests',
  ].join('; ');
}
