/**
 * The consent cookie.
 *
 * One first-party cookie that records whether the visitor let the one partner
 * script (Travelpayouts Drive) load. It holds the word `accepted` or the word
 * `declined` and nothing else - no identifier, no timestamp, no personal data.
 *
 * Deliberately not HttpOnly: the banner is a client component and the footer's
 * "Cookie settings" link must be able to tell which choice is standing. The
 * value gates a *script we choose to include*, so a hostile page script that
 * forges it gains nothing it could not do already; the server is what reads it
 * to decide what to send.
 *
 * Pure: no `cookies()`, no `document`, no clock.
 */

export const CONSENT_COOKIE = 'voyagr-consent';

export type ConsentChoice = 'accepted' | 'declined';

/** Twelve months, then the question is asked again. */
export const CONSENT_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

/** Anything other than an exact, known value is "no choice made". */
export function parseConsent(value: string | null | undefined): ConsentChoice | null {
  return value === 'accepted' || value === 'declined' ? value : null;
}

export function consentCookieOptions(secure: boolean) {
  return {
    httpOnly: false,
    sameSite: 'lax' as const,
    path: '/',
    maxAge: CONSENT_MAX_AGE_SECONDS,
    ...(secure ? { secure: true } : {}),
  };
}
