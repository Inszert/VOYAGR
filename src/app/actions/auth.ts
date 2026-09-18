'use server';

import { createHash } from 'node:crypto';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import {
  clearSessionCookie,
  getAuthService,
  getCurrentUser,
  getSessionToken,
  setSessionCookie,
} from '@/auth/current-user';
import { UNKNOWN_CLIENT } from '@/auth/service';
import { isAppError } from '@/lib/errors';
import { getLogger } from '@/lib/logger';

/**
 * Authentication server actions.
 *
 * Server Actions rather than route handlers, because Next verifies the request
 * origin for them, which is the CSRF protection a cookie-authenticated POST
 * needs. A hand-rolled `/api/sign-in` would need that check written here and
 * maintained forever instead.
 *
 * Every action returns a message the page renders beside the form, and only an
 * `AppError`'s public message is ever passed through: an unexpected failure
 * reaches the user as "something went wrong" and reaches the log in full.
 */

const log = getLogger('app.auth-actions');

export interface AuthFormState {
  readonly error?: string;
  /** Echoed back so a rejected form does not lose what was typed. */
  readonly email?: string;
}

/**
 * A stable, non-identifying handle for the client making the request.
 *
 * Hashed because it is only ever used as a throttle key: the raw address would
 * be personal data sitting in memory for no added benefit. Only as trustworthy
 * as the proxy in front of the app - `x-forwarded-for` is caller-supplied
 * unless something upstream overwrites it - which is why it narrows a lockout
 * rather than being the only defence.
 */
async function clientKey(): Promise<string> {
  const requestHeaders = await headers();
  const forwarded = requestHeaders.get('x-forwarded-for') ?? '';
  const address = forwarded.split(',')[0]?.trim() || requestHeaders.get('x-real-ip') || '';

  if (!address) return UNKNOWN_CLIENT;
  return createHash('sha256').update(address).digest('hex').slice(0, 32);
}

function publicMessage(error: unknown, fallback: string): string {
  if (isAppError(error)) return error.publicMessage;
  log.error({ err: error }, 'unexpected authentication failure');
  return fallback;
}

export async function signUpAction(
  _previous: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const email = String(formData.get('email') ?? '');
  const password = String(formData.get('password') ?? '');

  try {
    const issued = await getAuthService().register(email, password);
    await setSessionCookie(issued.token);
  } catch (error) {
    return { error: publicMessage(error, 'Could not create that account.'), email };
  }

  // Outside the try: `redirect` works by throwing, and catching it here would
  // turn a successful sign-up into "could not create that account".
  redirect('/account');
}

export async function signInAction(
  _previous: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const email = String(formData.get('email') ?? '');
  const password = String(formData.get('password') ?? '');

  try {
    const issued = await getAuthService().signIn(email, password, await clientKey());
    await setSessionCookie(issued.token);
  } catch (error) {
    return { error: publicMessage(error, 'Could not sign you in.'), email };
  }

  redirect('/account');
}

export async function signOutAction(): Promise<void> {
  const token = await getSessionToken();

  // The server-side session is destroyed first. Clearing only the cookie would
  // leave a token that still works for anyone who copied it.
  await getAuthService().signOut(token);
  await clearSessionCookie();

  redirect('/');
}

export interface PasswordFormState {
  readonly error?: string;
  readonly changed?: boolean;
}

/**
 * Change the signed-in user's password.
 *
 * Every session is destroyed by the service, including this one, so the cookie
 * is cleared here and the user is sent back to sign in. That is the intended
 * outcome rather than an inconvenience: a password change is usually a response
 * to suspecting someone else has the old one.
 */
export async function changePasswordAction(
  _previous: PasswordFormState,
  formData: FormData,
): Promise<PasswordFormState> {
  const user = await getCurrentUser();

  // Authorisation is checked here, not in the page that renders the form. An
  // action is an endpoint: anyone can post to it.
  if (!user) return { error: 'Sign in to change your password.' };

  const current = String(formData.get('currentPassword') ?? '');
  const next = String(formData.get('newPassword') ?? '');

  try {
    await getAuthService().changePassword(user.id, current, next);
  } catch (error) {
    return { error: publicMessage(error, 'Could not change your password.') };
  }

  await clearSessionCookie();
  redirect('/sign-in?passwordChanged=1');
}
