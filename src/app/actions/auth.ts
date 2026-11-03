'use server';

import { redirect } from 'next/navigation';
import {
  clearSessionCookie,
  getAuthService,
  getCurrentUser,
  getSessionToken,
  setSessionCookie,
} from '@/auth/current-user';
import { getRepositories } from '@/db';
import { isAppError } from '@/lib/errors';
import { resolveClientKey } from '@/lib/client-key';
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
    const issued = await getAuthService().signIn(email, password, await resolveClientKey());
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

export interface DeleteAccountState {
  readonly error?: string;
}

/**
 * Erase the signed-in account and everything personally attached to it.
 *
 * Deliberately hard to do by accident: the form requires the account's own
 * email address to be typed back, which a stray click cannot produce. The
 * check is on the server, because a confirmation enforced only in the
 * browser is not a confirmation.
 *
 * The user id comes from the verified session and never from the form. An
 * id in a request body would make this the most consequential IDOR in the
 * product.
 */
export async function deleteAccountAction(
  _previous: DeleteAccountState,
  formData: FormData,
): Promise<DeleteAccountState> {
  const user = await getCurrentUser();

  // Not "no such account": an unauthenticated caller learns nothing here.
  if (!user) return { error: 'Sign in again to delete your account.' };

  const typed = String(formData.get('confirmEmail') ?? '')
    .trim()
    .toLowerCase();

  if (typed !== user.email.toLowerCase()) {
    return { error: 'Type your email address exactly to confirm.' };
  }

  const repositories = await getRepositories();
  const summary = await repositories.users.erase(user.id);

  /*
   * Counts, never contents, and no email address.
   *
   * There is a real tension here: an erasure worth auditing is an erasure
   * that leaves a record, and a record of who was erased is the personal
   * data we just promised to remove. Counts settle it - enough to prove the
   * cascade ran, nothing that identifies anybody.
   */
  getLogger('account').info({ ...summary, userId: undefined }, 'account erased');

  // Every session died with the row; the cookie is cleared so this browser
  // does not keep presenting a token that no longer resolves.
  await clearSessionCookie();
  redirect('/?deleted=1');
}
