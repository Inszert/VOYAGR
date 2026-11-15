import { headers } from 'next/headers';

import { getConsent } from '@/consent/server';
import { driveScriptSrc } from '@/consent/drive';
import { getEnv } from '@/lib/env';

/**
 * Travelpayouts Drive: the partner network's site script for voyagrfind.com.
 *
 * The owner asked for it on every page (2026-11-14). It is the one third-party
 * script on the site, so it is fenced in:
 *
 *  - **Consent first.** It renders only when this request carries the
 *    `voyagr-consent=accepted` cookie. The check is on the server, so for a
 *    visitor who has not chosen, or declined, no `<script>` is in the HTML and
 *    the browser never contacts the host. The CSP is built from the same
 *    decision (`src/proxy.ts`), so the origin is not even allowed for them.
 *  - **Real production only.** Not in development, not in tests, and not in the
 *    e2e suite's production build (`ALLOW_MOCK_IN_PRODUCTION`), which asserts
 *    that nothing but our own origin is contacted.
 *  - **Loaded by `src`, with the request's CSP nonce.** The vendor's snippet is
 *    an inline script that appends this same tag; loading the file directly
 *    does the same job without an inline script, which `script-src` forbids.
 *  - **Its origin is named in the CSP** only for an accepted request. Any
 *    further host the script reaches for is blocked until it is added there
 *    deliberately.
 *
 * **Test-only seam.** With `DRIVE_TEST_STUB=true` *and* `ALLOW_MOCK_IN_PRODUCTION`
 * (both only ever set by `playwright.config.ts`), an accepted visitor gets the
 * same-origin stub `/api/test/drive-stub` instead of the vendor's host. That is
 * how the end-to-end suite exercises the gating with no third-party request.
 * A real deployment refuses to start with `ALLOW_MOCK_IN_PRODUCTION`, so the
 * seam cannot be switched on there.
 *
 * The id in the URL is the public site id from the Travelpayouts dashboard,
 * not a secret.
 */
export { DRIVE_ORIGIN } from '@/consent/drive';

export async function AffiliateDrive() {
  const env = getEnv();
  const src = driveScriptSrc({
    nodeEnv: env.NODE_ENV,
    allowMockInProduction: env.ALLOW_MOCK_IN_PRODUCTION,
    testStub: env.DRIVE_TEST_STUB,
    consent: await getConsent(),
  });
  if (!src) return null;

  const nonce = (await headers()).get('x-nonce') ?? undefined;
  return <script async src={src} nonce={nonce} data-cmp-ab="2" data-cfasync="false" />;
}
