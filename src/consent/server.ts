import { cookies } from 'next/headers';
import { CONSENT_COOKIE, parseConsent, type ConsentChoice } from './cookie';

/** This request's consent choice, read from its cookie. Null when none was made. */
export async function getConsent(): Promise<ConsentChoice | null> {
  return parseConsent((await cookies()).get(CONSENT_COOKIE)?.value);
}
