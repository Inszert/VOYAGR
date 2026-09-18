import { cookies } from 'next/headers';
import { getEnv } from '@/lib/env';
import { getRepositories } from '@/db';
import { AuthService, type AuthenticatedUser } from './service';
import { SESSION_COOKIE_NAME, sessionCookieOptions } from './session';

/**
 * Reading and writing the session cookie.
 *
 * The only place in the application that touches `cookies()` for authentication.
 * Everything else asks `getCurrentUser()` and gets an identity or null, so a
 * page never has to know the cookie's name, lifetime or flags - and cannot get
 * them subtly wrong.
 */

export function getAuthService(): AuthService {
  return new AuthService({ repositories: getRepositories() });
}

/** Secure cookies everywhere except plain-HTTP local development. */
function cookiesAreSecure(): boolean {
  return getEnv().NODE_ENV === 'production';
}

/**
 * The signed-in user, or null.
 *
 * Safe to call from any server component. Returns null rather than redirecting,
 * because "show the signed-out version of this page" is a legitimate answer and
 * far more common than "throw the user at a login screen".
 */
export async function getCurrentUser(): Promise<AuthenticatedUser | null> {
  const token = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  return getAuthService().authenticate(token);
}

/** The raw token, for the few operations that act on the session itself. */
export async function getSessionToken(): Promise<string | undefined> {
  return (await cookies()).get(SESSION_COOKIE_NAME)?.value;
}

export async function setSessionCookie(token: string): Promise<void> {
  (await cookies()).set(SESSION_COOKIE_NAME, token, sessionCookieOptions(cookiesAreSecure()));
}

export async function clearSessionCookie(): Promise<void> {
  // Overwritten with an immediate expiry rather than only deleted, so a client
  // that ignores `delete` still drops it.
  (await cookies()).set(SESSION_COOKIE_NAME, '', {
    ...sessionCookieOptions(cookiesAreSecure()),
    maxAge: 0,
  });
}
