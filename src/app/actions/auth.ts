'use server';

import { redirect } from 'next/navigation';
import {
  clearSessionCookie,
  getAuthService,
  getCurrentUser,
  getSessionToken,
  setSessionCookie,
} from '@/auth/current-user';
import { safeNextPath } from '@/auth/return-to';
import type { Registered } from '@/auth/service';
import {
  describeSignUpFailure,
  describeUnsentVerification,
  SIGN_UP_FAILURE_SENTENCE,
} from '@/auth/sign-up-failure';
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
  const next = safeNextPath(formData.get('next'));

  let registered: Registered;

  try {
    registered = await getAuthService().register(email, password);
    await setSessionCookie(registered.token);
  } catch (error) {
    // One line, so the owner can see why in the console or host logs. Only the
    // reason, the AppError code and a scrubbed message are logged: never the
    // address or the password.
    const failure = describeSignUpFailure(error);
    log.error(
      { reason: failure.reason, code: failure.code, message: failure.message },
      SIGN_UP_FAILURE_SENTENCE[failure.reason],
    );

    return {
      error: isAppError(error) ? error.publicMessage : 'Could not create that account.',
      email,
    };
  }

  if (!registered.verificationEmailSent) {
    const unsent = describeUnsentVerification(registered.verificationEmailFailure);
    log.warn(
      { reason: 'VERIFICATION_EMAIL_NOT_SENT', code: unsent.code, message: unsent.message },
      `Account created, but the verification email was not sent: ${unsent.message}`,
    );
  }

  // Outside the try: `redirect` works by throwing, and catching it here would
  // turn a successful sign-up into "could not create that account".
  //
  // Signed in either way, so the sign-up page itself cannot be the place to
  // say the mail failed: it sends a signed-in visitor to the account, and the
  // re-render after this action would do exactly that. The account page says it.
  // A person who arrived from an invite link goes back to it; `safeNextPath`
  // admits only same-origin relative paths.
  if (next) redirect(next);
  redirect(registered.verificationEmailSent ? '/account' : '/account?verification=unsent');
}

export async function signInAction(
  _previous: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const email = String(formData.get('email') ?? '');
  const password = String(formData.get('password') ?? '');
  const next = safeNextPath(formData.get('next'));

  try {
    const issued = await getAuthService().signIn(email, password, await resolveClientKey());
    await setSessionCookie(issued.token);
  } catch (error) {
    return { error: publicMessage(error, 'Could not sign you in.'), email };
  }

  redirect(next ?? '/account');
}

export async function signOutAction(): Promise<void> {
  const token = await getSessionToken();

  // The server-side session is destroyed first. Clearing only the cookie would
  // leave a token that still works for anyone who copied it.
  await getAuthService().signOut(token);
  await clearSessionCookie();

  redirect('/');
}

/**
 * Sign out of every device at once, including this one.
 *
 * The user id comes from the verified session, same reason
 * `deleteAccountAction` does not take one from the form.
 */
export async function signOutEverywhereAction(): Promise<void> {
  const user = await getCurrentUser();
  if (!user) redirect('/sign-in');

  await getAuthService().signOutEverywhere(user.id);
  await clearSessionCookie();

  redirect('/sign-in?signedOutEverywhere=1');
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

export interface EmailChangeFormState {
  readonly error?: string;
  readonly message?: string;
}

/**
 * Request moving the signed-in account to a new email address.
 *
 * Unlike `changePasswordAction`, nothing is signed out and nothing has
 * changed yet - `AuthService.requestEmailChange` only sends a link to the
 * *new* address. The address itself moves when that link is confirmed, in
 * `/api/confirm-email-change`.
 */
export async function requestEmailChangeAction(
  _previous: EmailChangeFormState,
  formData: FormData,
): Promise<EmailChangeFormState> {
  const user = await getCurrentUser();
  if (!user) return { error: 'Sign in to change your email address.' };

  const currentPassword = String(formData.get('currentPassword') ?? '');
  const newEmail = String(formData.get('newEmail') ?? '');

  try {
    await getAuthService().requestEmailChange(
      user.id,
      currentPassword,
      newEmail,
      await resolveClientKey(),
    );
  } catch (error) {
    return { error: publicMessage(error, 'Could not start the email change.') };
  }

  return { message: `Check ${newEmail} for a link to confirm the change.` };
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

export interface ResendVerificationState {
  readonly message?: string;
  readonly error?: string;
}

/**
 * Resend the verification email for the signed-in account.
 *
 * The user id comes from the session, never from the form - the same reason
 * `deleteAccountAction` does not take one. Reports success whether or not
 * there was anything to send: whether an unverified account existed to resend
 * for is not this response's business to reveal, and
 * `AuthService.resendVerificationEmail` already no-ops safely for an
 * already-verified one. The one exception is a throttled request, which says
 * so - the caller is signed in, so that reveals nothing about anyone else.
 */
export async function resendVerificationAction(
  _previous: ResendVerificationState,
  _formData: FormData,
): Promise<ResendVerificationState> {
  const user = await getCurrentUser();
  if (!user) return { error: 'Sign in again to resend your verification email.' };

  try {
    await getAuthService().resendVerificationEmail(user.id, await resolveClientKey());
  } catch (error) {
    return { error: publicMessage(error, 'Could not resend the verification email.') };
  }

  return { message: 'Verification email sent. Check your inbox.' };
}

export interface RequestPasswordResetState {
  readonly message?: string;
}

/**
 * Request a password reset link, from the sign-in page.
 *
 * Always returns the same message regardless of whether the address is
 * registered - `AuthService.requestPasswordReset` already holds that
 * discipline, and repeating "if an account exists" here would be the right
 * wording undone by whatever error path a bug introduces later. There is
 * deliberately no error case; the only way this throws is a bug, and a bug
 * here should not turn into evidence about which addresses are registered.
 */
export async function requestPasswordResetAction(
  _previous: RequestPasswordResetState,
  formData: FormData,
): Promise<RequestPasswordResetState> {
  const email = String(formData.get('email') ?? '');
  await getAuthService().requestPasswordReset(email, await resolveClientKey());

  return { message: 'If that address has an account, a reset link is on its way.' };
}

export interface ResetPasswordState {
  readonly error?: string;
}

/**
 * Consume a password reset link and set a new password.
 *
 * The token comes from a hidden field the page filled in from its own URL,
 * not from anything this action re-derives - see
 * `src/app/(column)/reset-password/page.tsx`.
 */
export async function resetPasswordAction(
  _previous: ResetPasswordState,
  formData: FormData,
): Promise<ResetPasswordState> {
  const token = String(formData.get('token') ?? '');
  const password = String(formData.get('password') ?? '');

  try {
    await getAuthService().resetPassword(token, password);
  } catch (error) {
    return { error: publicMessage(error, 'Could not reset your password.') };
  }

  redirect('/sign-in?reset=1');
}
