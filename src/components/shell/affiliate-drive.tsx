import { headers } from 'next/headers';

import { getEnv } from '@/lib/env';

/**
 * Travelpayouts Drive: the partner network's site script for voyagrfind.com.
 *
 * The owner asked for it on every page (2026-11-14). It is the one third-party
 * script on the site, so it is fenced in:
 *
 *  - **Real production only.** Not in development, not in tests, and not in the
 *    e2e suite's production build (`ALLOW_MOCK_IN_PRODUCTION`), which asserts
 *    that nothing but our own origin is contacted.
 *  - **Loaded by `src`, with the request's CSP nonce.** The vendor's snippet is
 *    an inline script that appends this same tag; loading the file directly
 *    does the same job without an inline script, which `script-src` forbids.
 *  - **Its origin is named in the CSP** (`src/proxy.ts`, `DRIVE_ORIGIN`). Any
 *    further host the script reaches for is blocked until it is added there
 *    deliberately.
 *
 * The id in the URL is the public site id from the Travelpayouts dashboard,
 * not a secret.
 */
export const DRIVE_ORIGIN = 'https://emrldco.com';
const DRIVE_SRC = `${DRIVE_ORIGIN}/NTc2Nzgx.js?t=576781`;

export function driveEnabled(env: {
  NODE_ENV: string;
  ALLOW_MOCK_IN_PRODUCTION: boolean;
}): boolean {
  return env.NODE_ENV === 'production' && !env.ALLOW_MOCK_IN_PRODUCTION;
}

export async function AffiliateDrive() {
  if (!driveEnabled(getEnv())) return null;
  const nonce = (await headers()).get('x-nonce') ?? undefined;
  return <script async src={DRIVE_SRC} nonce={nonce} data-cmp-ab="2" data-cfasync="false" />;
}
