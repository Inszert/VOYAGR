'use server';

import { cookies } from 'next/headers';
import { CONSENT_COOKIE, consentCookieOptions, parseConsent } from '@/consent/cookie';
import { getEnv } from '@/lib/env';

/**
 * Record the visitor's cookie choice.
 *
 * A Server Action rather than a route handler, for the reason the data-source
 * action gives: Next verifies the request origin for an action, which is the
 * CSRF protection a cookie-setting POST needs. A cross-site page therefore
 * cannot make a visitor "accept" on their behalf.
 *
 * The value is validated against the two words we write; anything else is
 * ignored rather than stored. The cookie holds that word and nothing else.
 */
export async function setConsentAction(choice: string): Promise<void> {
  const value = parseConsent(choice);
  if (!value) return;

  (await cookies()).set(
    CONSENT_COOKIE,
    value,
    consentCookieOptions(getEnv().NODE_ENV === 'production'),
  );
}
