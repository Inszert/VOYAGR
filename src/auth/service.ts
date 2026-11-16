import { randomUUID } from 'node:crypto';
import { DEFAULT_PLAN_ID, resolveEntitlements, type Entitlements } from '@/core/entitlements';
import { AppError } from '@/lib/errors';
import { getEnv } from '@/lib/env';
import { getLogger } from '@/lib/logger';
import type { Repositories, UserRecord } from '@/db/repository';
import { getEmailProvider } from '@/email/registry';
import type { EmailProvider } from '@/email/types';
import { emailChangeTemplate, passwordResetTemplate, welcomeTemplate } from '@/email/templates';
import {
  emailChangeTokenExpiry,
  hashEmailChangeToken,
  isEmailChangeTokenExpired,
  issueEmailChangeToken,
} from './email-change';
import {
  hashVerificationToken,
  isVerificationTokenExpired,
  issueVerificationToken,
  verificationTokenExpiry,
} from './email-verification';
import { getDecoyHash, hashPassword, MIN_PASSWORD_LENGTH, verifyPassword } from './password';
import {
  hashPasswordResetToken,
  isPasswordResetTokenExpired,
  issuePasswordResetToken,
  passwordResetTokenExpiry,
} from './password-reset';
import { hashSessionToken, isExpired, issueSessionToken, sessionExpiry } from './session';
import {
  ACCOUNT_SEND_LIMIT,
  CLIENT_SEND_LIMIT,
  getSendThrottle,
  getSignInThrottle,
  type SendEntry,
  type SendThrottle,
  type SignInThrottle,
  type ThrottleDecision,
} from './throttle';

/**
 * Authentication service.
 *
 * Email and password, with server-side sessions. Chosen because it needs no
 * external identity provider, no new dependency and no credentials in a config
 * file, so the whole app still runs and tests offline - the same property every
 * other seam in this codebase holds.
 *
 * It is an implementation, not a commitment. Everything above this module deals
 * in `AuthenticatedUser` and a session cookie, so adding OAuth later means a
 * second way to create a session, not a rewrite of every page that reads one.
 *
 * Two behaviours are deliberate and worth not "simplifying" later:
 *  - Sign-in never reveals whether an email exists. Same message, same work and
 *    the same approximate timing whether the address is registered or not.
 *  - Sessions are rotated on sign-in and destroyed wholesale on a password
 *    change, so a stolen token does not outlive the response to it.
 */

const log = getLogger('auth.service');

export interface AuthenticatedUser {
  readonly id: string;
  readonly email: string;
  readonly plan: string;
  readonly entitlements: Entitlements;
  readonly emailVerified: boolean;
}

export interface SessionIssued {
  readonly user: AuthenticatedUser;
  /** The raw token for the cookie. Never stored and never logged. */
  readonly token: string;
  readonly expiresAt: string;
}

/** A new account's session, and whether its verification email went out. */
export interface Registered extends SessionIssued {
  /**
   * False when the account was created but the mail could not be sent - no
   * email provider configured in production, or the provider failing. The
   * sign-up page says so rather than leaving someone waiting for a message
   * that is not coming.
   */
  readonly verificationEmailSent: boolean;
}

export interface AuthDependencies {
  readonly repositories: Repositories;
  readonly throttle?: SignInThrottle;
  readonly sendThrottle?: SendThrottle;
  readonly now?: () => number;
  readonly emailProvider?: EmailProvider;
  /** The app's own canonical origin, for the link in a verification email. */
  readonly appUrl?: string;
}

/** Same message for every sign-in failure, on purpose. */
const SIGN_IN_FAILED = 'That email and password combination is not correct.';

/** Used when no client identifier could be established. */
export const UNKNOWN_CLIENT = 'unknown-client';

/**
 * The key a sign-in attempt is throttled under.
 *
 * Email *and* client, not email alone. Throttling on the address by itself
 * turns the lockout into a weapon: anyone who knows your email can fail eight
 * times and keep you out of your own account for a quarter of an hour. Keying
 * on both means an attacker locks out only themselves.
 *
 * This does not stop a distributed attempt across many addresses from many
 * clients. What stops that is scrypt: every guess costs the attacker 32 MiB and
 * real time, whether or not it is throttled.
 */
export function throttleKey(email: string, client: string): string {
  return `${email}|${client}`;
}

type SendKind = 'password-reset' | 'verification' | 'email-change';

/**
 * What one email-sending request is counted against: the account, and the
 * client when we know which one it is.
 *
 * With no client identifier every anonymous caller would share one bucket, and
 * ten of them would lock everybody out of password reset. The account limit
 * still applies, so the unknown case is weaker, not unprotected.
 */
export function sendEntries(kind: SendKind, account: string, client: string): SendEntry[] {
  const entries: SendEntry[] = [{ key: `${kind}:account:${account}`, limit: ACCOUNT_SEND_LIMIT }];
  if (client !== UNKNOWN_CLIENT) {
    entries.push({ key: `${kind}:client:${client}`, limit: CLIENT_SEND_LIMIT });
  }
  return entries;
}

function sendThrottledError(decision: ThrottleDecision): AppError {
  return new AppError('RATE_LIMITED', 'Email send throttled', {
    publicMessage: `Too many requests. Try again in ${Math.ceil(
      decision.retryAfterSeconds / 60,
    )} minutes.`,
    context: { retryAfterSeconds: decision.retryAfterSeconds },
  });
}

export function toAuthenticatedUser(user: UserRecord): AuthenticatedUser {
  return {
    id: user.id,
    email: user.email,
    plan: user.plan,
    entitlements: resolveEntitlements(user.plan),
    emailVerified: user.emailVerifiedAt !== null,
  };
}

/** Lowercased and trimmed, so one address cannot become two accounts. */
export function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Shape check only.
 *
 * Deliberately permissive: the authority on whether an address exists is a
 * message sent to it, not a regular expression, and an over-clever pattern
 * rejects valid addresses for no benefit.
 */
export function isPlausibleEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254;
}

export class AuthService {
  private readonly repositories: Repositories;
  private readonly throttle: SignInThrottle;
  private readonly sendThrottle: SendThrottle;
  private readonly now: () => number;
  private readonly emailProvider: EmailProvider;
  private readonly appUrl: string;

  constructor(dependencies: AuthDependencies) {
    this.repositories = dependencies.repositories;
    this.throttle = dependencies.throttle ?? getSignInThrottle();
    this.sendThrottle = dependencies.sendThrottle ?? getSendThrottle();
    this.now = dependencies.now ?? Date.now;
    this.emailProvider = dependencies.emailProvider ?? getEmailProvider();
    this.appUrl = dependencies.appUrl ?? getEnv().NEXT_PUBLIC_APP_URL;
  }

  /**
   * Create an account and sign it in.
   *
   * @throws AppError CONFLICT when the email is taken, VALIDATION_ERROR when
   *   the email or password is unusable.
   */
  async register(rawEmail: string, password: string): Promise<Registered> {
    const email = normaliseEmail(rawEmail);

    if (!isPlausibleEmail(email)) {
      throw new AppError('VALIDATION_ERROR', 'Implausible email address', {
        publicMessage: 'Enter a valid email address.',
      });
    }

    if (password.length < MIN_PASSWORD_LENGTH) {
      throw new AppError('VALIDATION_ERROR', 'Password below the minimum length', {
        publicMessage: `Use a password of at least ${MIN_PASSWORD_LENGTH} characters.`,
      });
    }

    if (await this.repositories.users.findByEmail(email)) {
      // Registration does reveal existence, and cannot not: two accounts cannot
      // share an address. Sign-in, which is the attacker's cheap oracle, does not.
      throw new AppError('CONFLICT', 'Email already registered', {
        publicMessage: 'An account with that email already exists.',
      });
    }

    const user = await this.repositories.users.create({
      id: randomUUID(),
      email,
      plan: DEFAULT_PLAN_ID,
    });

    await this.repositories.credentials.upsert(user.id, await hashPassword(password));

    log.info({ userId: user.id }, 'account created');

    // A failed verification email must not fail the sign-up that triggered
    // it - the account is real either way, and the account page's "resend"
    // button exists precisely for this case.
    const verificationEmailSent = await this.issueAndSendVerificationEmail(user).catch(
      (error: unknown) => {
        log.warn({ err: error, userId: user.id }, 'verification email could not be sent');
        return false;
      },
    );

    return { ...(await this.startSession(user)), verificationEmailSent };
  }

  /**
   * (Re)send a verification email, replacing any outstanding token.
   *
   * Replacing rather than adding means an old, forwarded link stops working
   * the moment a fresh one is requested - exactly one link is ever valid.
   *
   * @throws AppError RATE_LIMITED when this account or client has asked too
   *   often. Safe to say so: the caller is signed in, so it reveals nothing.
   */
  async resendVerificationEmail(userId: string, client: string = UNKNOWN_CLIENT): Promise<void> {
    const decision = this.sendThrottle.consume(sendEntries('verification', userId, client));
    if (!decision.allowed) throw sendThrottledError(decision);

    const user = await this.repositories.users.findById(userId);
    if (!user) return;

    if (user.emailVerifiedAt !== null) return;

    await this.issueAndSendVerificationEmail(user);
  }

  /**
   * Consume a verification token.
   *
   * One-time use: the token is deleted whether or not it was still valid, so
   * a captured or forwarded link cannot be replayed even within its window.
   *
   * @throws AppError VALIDATION_ERROR when the token is unknown or expired.
   */
  async verifyEmail(token: string): Promise<void> {
    const tokenHash = hashVerificationToken(token);
    const record = await this.repositories.emailVerification.findByTokenHash(tokenHash);

    if (!record) {
      throw new AppError('VALIDATION_ERROR', 'Unknown verification token', {
        publicMessage:
          'That verification link is not valid. Request a new one from your account page.',
      });
    }

    await this.repositories.emailVerification.delete(record.id);

    if (isVerificationTokenExpired(record.expiresAt, this.now())) {
      throw new AppError('VALIDATION_ERROR', 'Expired verification token', {
        publicMessage:
          'That verification link has expired. Request a new one from your account page.',
      });
    }

    await this.repositories.users.update(record.userId, {
      emailVerifiedAt: new Date(this.now()).toISOString(),
    });

    log.info({ userId: record.userId }, 'email verified');
  }

  /** True when the provider accepted the mail; a failure is logged, never thrown. */
  private async issueAndSendVerificationEmail(user: UserRecord): Promise<boolean> {
    // However many are outstanding, only the newest one sent should work.
    await this.repositories.emailVerification.deleteForUser(user.id);

    const { token, tokenHash } = issueVerificationToken();

    await this.repositories.emailVerification.create({
      id: randomUUID(),
      userId: user.id,
      tokenHash,
      expiresAt: verificationTokenExpiry(this.now()),
    });

    const link = `${this.appUrl}/api/verify-email?token=${token}`;

    const mail = welcomeTemplate({ link });
    const result = await this.emailProvider.send({ to: user.email, ...mail });

    if (!result.ok) {
      log.warn({ err: result.error, userId: user.id }, 'verification email provider failed');
    }

    return result.ok;
  }

  /**
   * Verify a password and start a session.
   *
   * @throws AppError UNAUTHORIZED on any failure, RATE_LIMITED when throttled.
   */
  async signIn(
    rawEmail: string,
    password: string,
    client: string = UNKNOWN_CLIENT,
  ): Promise<SessionIssued> {
    const email = normaliseEmail(rawEmail);
    const key = throttleKey(email, client);

    const decision = this.throttle.check(key);
    if (!decision.allowed) {
      throw new AppError('RATE_LIMITED', 'Sign-in throttled', {
        publicMessage: `Too many attempts. Try again in ${Math.ceil(
          decision.retryAfterSeconds / 60,
        )} minutes.`,
        context: { retryAfterSeconds: decision.retryAfterSeconds },
      });
    }

    const user = await this.repositories.users.findByEmail(email);
    const credential = user ? await this.repositories.credentials.findByUserId(user.id) : null;

    // Verify against a decoy when there is no account, so the response time
    // does not answer "is this address registered?".
    const stored = credential?.passwordHash ?? (await getDecoyHash());
    const correct = await verifyPassword(password, stored);

    if (!user || !credential || !correct) {
      this.throttle.recordFailure(key);
      log.warn({ emailKnown: Boolean(user) }, 'sign-in rejected');

      throw new AppError('UNAUTHORIZED', 'Sign-in failed', { publicMessage: SIGN_IN_FAILED });
    }

    this.throttle.recordSuccess(key);
    log.info({ userId: user.id }, 'signed in');

    return this.startSession(user);
  }

  /**
   * Resolve the user behind a session token.
   *
   * Returns null for anything wrong - no token, unknown token, expired session,
   * deleted account. A caller asking "who is this?" wants an answer, not an
   * exception.
   */
  async authenticate(token: string | undefined): Promise<AuthenticatedUser | null> {
    if (!token) return null;

    const session = await this.repositories.sessions.findByTokenHash(hashSessionToken(token));
    if (!session) return null;

    if (isExpired(session.expiresAt, this.now())) {
      // Clean up on the way past rather than leaving it for a sweeper.
      await this.repositories.sessions.delete(session.id);
      return null;
    }

    const user = await this.repositories.users.findById(session.userId);
    if (!user) {
      // The account is gone but its session outlived it. Not a valid identity.
      await this.repositories.sessions.delete(session.id);
      return null;
    }

    return toAuthenticatedUser(user);
  }

  async signOut(token: string | undefined): Promise<void> {
    if (!token) return;

    const session = await this.repositories.sessions.findByTokenHash(hashSessionToken(token));
    if (session) await this.repositories.sessions.delete(session.id);
  }

  /**
   * End every session for a user, including the one making this call.
   *
   * Deliberately all-or-nothing rather than "every device but this one":
   * `changePassword` and `resetPassword` already end every session on the
   * same reasoning, and a user who asked to sign out everywhere typing
   * their password again on this device too is a small cost next to the
   * complexity of tracking which session is "this one" through a repository
   * interface that otherwise never needs to know.
   */
  async signOutEverywhere(userId: string): Promise<void> {
    await this.repositories.sessions.deleteForUser(userId);
    log.info({ userId }, 'signed out of every session');
  }

  /**
   * Change a password and invalidate every existing session.
   *
   * Signing out everywhere is the point: a password change is usually a
   * response to suspecting someone else has the old one.
   */
  async changePassword(userId: string, current: string, next: string): Promise<void> {
    const credential = await this.repositories.credentials.findByUserId(userId);

    if (!credential || !(await verifyPassword(current, credential.passwordHash))) {
      throw new AppError('UNAUTHORIZED', 'Current password incorrect', {
        publicMessage: 'Your current password is not correct.',
      });
    }

    if (next.length < MIN_PASSWORD_LENGTH) {
      throw new AppError('VALIDATION_ERROR', 'New password below the minimum length', {
        publicMessage: `Use a password of at least ${MIN_PASSWORD_LENGTH} characters.`,
      });
    }

    await this.repositories.credentials.upsert(userId, await hashPassword(next));
    await this.repositories.sessions.deleteForUser(userId);

    log.info({ userId }, 'password changed, all sessions invalidated');
  }

  /**
   * Request a password reset link.
   *
   * Never reveals whether the address is registered - same work, same
   * return value, whether or not a matching account exists. This is the
   * same discipline `signIn` already holds for the same reason: sign-in's
   * generic failure message is the one place this app already refuses to
   * answer "does this email exist?", and a reset request is the same
   * question asked a different way.
   *
   * Throttled per address and per client, and a throttled request returns
   * exactly as a sent one does - an error here would tell a stranger that the
   * address has been asked about recently. The address is counted whether or
   * not an account exists, so the budget cannot be used to tell the two apart.
   * The cost is that anyone can use up an address's three an hour; the reset
   * email is then late, not lost, which is the better side of that trade.
   */
  async requestPasswordReset(rawEmail: string, client: string = UNKNOWN_CLIENT): Promise<void> {
    const email = normaliseEmail(rawEmail);

    const decision = this.sendThrottle.consume(sendEntries('password-reset', email, client));
    if (!decision.allowed) {
      log.warn({ retryAfterSeconds: decision.retryAfterSeconds }, 'password reset throttled');
      return;
    }

    const user = await this.repositories.users.findByEmail(email);

    if (!user) {
      log.info('password reset requested for an unregistered address');
      return;
    }

    await this.repositories.passwordReset.deleteForUser(user.id);

    const { token, tokenHash } = issuePasswordResetToken();

    await this.repositories.passwordReset.create({
      id: randomUUID(),
      userId: user.id,
      tokenHash,
      expiresAt: passwordResetTokenExpiry(this.now()),
    });

    const link = `${this.appUrl}/reset-password?token=${token}`;

    const mail = passwordResetTemplate({ link });
    const result = await this.emailProvider.send({ to: user.email, ...mail });

    if (!result.ok) {
      log.warn({ err: result.error, userId: user.id }, 'password reset email provider failed');
    }
  }

  /**
   * Consume a password reset token and set a new password.
   *
   * One-time use and invalidates every session, same as `changePassword` -
   * a password reset is just as much a reason to distrust existing sessions
   * as a voluntary change is, arguably more so.
   *
   * @throws AppError VALIDATION_ERROR when the token is unknown, expired, or
   *   the new password is too short.
   */
  async resetPassword(token: string, next: string): Promise<void> {
    const tokenHash = hashPasswordResetToken(token);
    const record = await this.repositories.passwordReset.findByTokenHash(tokenHash);

    if (!record) {
      throw new AppError('VALIDATION_ERROR', 'Unknown password reset token', {
        publicMessage: 'That reset link is not valid. Request a new one from the sign-in page.',
      });
    }

    await this.repositories.passwordReset.delete(record.id);

    if (isPasswordResetTokenExpired(record.expiresAt, this.now())) {
      throw new AppError('VALIDATION_ERROR', 'Expired password reset token', {
        publicMessage: 'That reset link has expired. Request a new one from the sign-in page.',
      });
    }

    if (next.length < MIN_PASSWORD_LENGTH) {
      throw new AppError('VALIDATION_ERROR', 'New password below the minimum length', {
        publicMessage: `Use a password of at least ${MIN_PASSWORD_LENGTH} characters.`,
      });
    }

    await this.repositories.credentials.upsert(record.userId, await hashPassword(next));
    await this.repositories.sessions.deleteForUser(record.userId);

    log.info({ userId: record.userId }, 'password reset, all sessions invalidated');
  }

  /**
   * Request moving the account to a new email address.
   *
   * Requires the current password - the same re-authentication
   * `changePassword` requires - because this is a signed-in action, not a
   * public one like `requestPasswordReset`: a stolen session alone must not
   * be enough to redirect the account's recovery address somewhere an
   * attacker controls. `users.email` is not touched yet; only confirming
   * the link sent to the *new* address does that - see
   * `confirmEmailChange`.
   *
   * Unlike `requestPasswordReset`, this does reveal whether the new address
   * is already taken. That is not an enumeration leak the same way: calling
   * this at all already requires a valid session and the account's current
   * password, which is a much higher bar than the anonymous "does this
   * email exist?" question sign-in and password reset both refuse to
   * answer. `register` already makes the identical call for the identical
   * reason - two accounts cannot share an address, and that fact cannot be
   * hidden from whoever is trying to create the second one.
   *
   * Throttled before the password is checked, so a refused request also costs
   * no scrypt. Wrong-password attempts count against the allowance.
   *
   * @throws AppError UNAUTHORIZED on the wrong password, VALIDATION_ERROR on
   *   an implausible address, CONFLICT when another account already holds it,
   *   RATE_LIMITED when asked too often.
   */
  async requestEmailChange(
    userId: string,
    currentPassword: string,
    rawNewEmail: string,
    client: string = UNKNOWN_CLIENT,
  ) {
    const decision = this.sendThrottle.consume(sendEntries('email-change', userId, client));
    if (!decision.allowed) throw sendThrottledError(decision);

    const credential = await this.repositories.credentials.findByUserId(userId);

    if (!credential || !(await verifyPassword(currentPassword, credential.passwordHash))) {
      throw new AppError('UNAUTHORIZED', 'Current password incorrect', {
        publicMessage: 'Your current password is not correct.',
      });
    }

    const newEmail = normaliseEmail(rawNewEmail);
    if (!isPlausibleEmail(newEmail)) {
      throw new AppError('VALIDATION_ERROR', 'Implausible email address', {
        publicMessage: 'Enter a valid email address.',
      });
    }

    if (await this.repositories.users.findByEmail(newEmail)) {
      throw new AppError('CONFLICT', 'Email already registered', {
        publicMessage: 'An account with that email already exists.',
      });
    }

    // However many are outstanding, only the newest request should work.
    await this.repositories.emailChange.deleteForUser(userId);

    const { token, tokenHash } = issueEmailChangeToken();

    await this.repositories.emailChange.create({
      id: randomUUID(),
      userId,
      newEmail,
      tokenHash,
      expiresAt: emailChangeTokenExpiry(this.now()),
    });

    const link = `${this.appUrl}/api/confirm-email-change?token=${token}`;

    const mail = emailChangeTemplate({ link, newEmail });
    const result = await this.emailProvider.send({ to: newEmail, ...mail });

    if (!result.ok) {
      log.warn({ err: result.error, userId }, 'email change confirmation could not be sent');
    }
  }

  /**
   * Consume an email change link and move the account to the new address.
   *
   * One-time use, and every session is invalidated afterwards - the same
   * reasoning `changePassword` and `resetPassword` already hold: whatever
   * is signed in under the old address should have to prove it again under
   * the new one.
   *
   * @throws AppError VALIDATION_ERROR when the token is unknown or expired,
   *   CONFLICT when the address was taken by someone else in the meantime.
   */
  async confirmEmailChange(token: string): Promise<void> {
    const tokenHash = hashEmailChangeToken(token);
    const record = await this.repositories.emailChange.findByTokenHash(tokenHash);

    if (!record) {
      throw new AppError('VALIDATION_ERROR', 'Unknown email change token', {
        publicMessage:
          'That confirmation link is not valid. Request a new one from your account page.',
      });
    }

    await this.repositories.emailChange.delete(record.id);

    if (isEmailChangeTokenExpired(record.expiresAt, this.now())) {
      throw new AppError('VALIDATION_ERROR', 'Expired email change token', {
        publicMessage:
          'That confirmation link has expired. Request a new one from your account page.',
      });
    }

    await this.repositories.users.updateEmail(record.userId, record.newEmail);
    // `updateEmail` clears verification because the old claim was about the old address. But
    // this link was delivered to the new inbox and clicked, which is exactly the proof
    // verification asks for - leaving it unset would make the user confirm the same address twice,
    // and would keep the email alerts that need a verified address switched off.
    await this.repositories.users.update(record.userId, {
      emailVerifiedAt: new Date(this.now()).toISOString(),
    });
    await this.repositories.sessions.deleteForUser(record.userId);

    log.info({ userId: record.userId }, 'email changed, all sessions invalidated');
  }

  private async startSession(user: UserRecord): Promise<SessionIssued> {
    const { token, tokenHash } = issueSessionToken();
    const expiresAt = sessionExpiry(this.now());

    await this.repositories.sessions.create({
      id: randomUUID(),
      userId: user.id,
      tokenHash,
      expiresAt,
    });

    return { user: toAuthenticatedUser(user), token, expiresAt };
  }
}
