import { randomUUID } from 'node:crypto';
import { DEFAULT_PLAN_ID, resolveEntitlements, type Entitlements } from '@/core/entitlements';
import { AppError } from '@/lib/errors';
import { getEnv } from '@/lib/env';
import { getLogger } from '@/lib/logger';
import type { Repositories, UserRecord } from '@/db/repository';
import { getEmailProvider } from '@/email/registry';
import type { EmailProvider } from '@/email/types';
import {
  hashVerificationToken,
  isVerificationTokenExpired,
  issueVerificationToken,
  verificationTokenExpiry,
} from './email-verification';
import { getDecoyHash, hashPassword, MIN_PASSWORD_LENGTH, verifyPassword } from './password';
import { hashSessionToken, isExpired, issueSessionToken, sessionExpiry } from './session';
import { getSignInThrottle, type SignInThrottle } from './throttle';

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

export interface AuthDependencies {
  readonly repositories: Repositories;
  readonly throttle?: SignInThrottle;
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
  private readonly now: () => number;
  private readonly emailProvider: EmailProvider;
  private readonly appUrl: string;

  constructor(dependencies: AuthDependencies) {
    this.repositories = dependencies.repositories;
    this.throttle = dependencies.throttle ?? getSignInThrottle();
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
  async register(rawEmail: string, password: string): Promise<SessionIssued> {
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
    await this.issueAndSendVerificationEmail(user).catch((error: unknown) => {
      log.warn({ err: error, userId: user.id }, 'verification email could not be sent');
    });

    return this.startSession(user);
  }

  /**
   * (Re)send a verification email, replacing any outstanding token.
   *
   * Replacing rather than adding means an old, forwarded link stops working
   * the moment a fresh one is requested - exactly one link is ever valid.
   */
  async resendVerificationEmail(userId: string): Promise<void> {
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

  private async issueAndSendVerificationEmail(user: UserRecord): Promise<void> {
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

    const result = await this.emailProvider.send({
      to: user.email,
      subject: 'Confirm your email for Voyagr',
      text:
        `Click to confirm this address: ${link}\n\n` +
        `This link works once and expires in 24 hours. If you did not create a Voyagr account, ignore this email.`,
    });

    if (!result.ok) {
      log.warn({ err: result.error, userId: user.id }, 'verification email provider failed');
    }
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
