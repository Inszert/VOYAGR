import { toAppError, type AppError } from '@/lib/errors';

/**
 * Why a sign-up did not produce an account, in a form the owner can read in the
 * server log.
 *
 * Kept out of `src/app/actions/auth.ts` because a `'use server'` module may export
 * only async functions, and this is plain code that is tested directly.
 *
 * Log-only. The visitor keeps the message the action has always returned.
 */

export type SignUpFailureReason =
  | 'DATABASE_UNREACHABLE'
  | 'DATABASE_ERROR'
  | 'EMAIL_NOT_CONFIGURED'
  | 'VALIDATION'
  | 'EMAIL_ALREADY_REGISTERED'
  | 'UNKNOWN';

export interface SignUpFailure {
  readonly reason: SignUpFailureReason;
  /** The AppError code, or INTERNAL_ERROR for anything that was not one. */
  readonly code: string;
  /** Scrubbed of email addresses and capped in length. */
  readonly message: string;
}

/** The plain sentence a log line leads with, one per reason. */
export const SIGN_UP_FAILURE_SENTENCE: Record<SignUpFailureReason, string> = {
  DATABASE_UNREACHABLE: 'Could not create the account: the database could not be reached.',
  DATABASE_ERROR: 'Could not create the account: the database rejected the request.',
  EMAIL_NOT_CONFIGURED: 'Could not create the account: email delivery is not configured.',
  VALIDATION: 'Could not create the account: the email or password failed validation.',
  EMAIL_ALREADY_REGISTERED: 'Could not create the account: that email already has an account.',
  UNKNOWN: 'Could not create the account: unexpected error.',
};

const MAX_MESSAGE_LENGTH = 300;

/** Node network codes, and SQLSTATE class 08 (connection exception) plus the 57P0x shutdown codes. */
const CONNECTION_CODES: ReadonlySet<string> = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ENOTFOUND',
  'EAI_AGAIN',
  'ETIMEDOUT',
  'EHOSTUNREACH',
  'ENETUNREACH',
  '08000',
  '08001',
  '08003',
  '08004',
  '08006',
  '57P01',
  '57P02',
  '57P03',
]);

/**
 * Remove anything shaped like an email address, collapse whitespace and cap the length.
 *
 * Driver errors quote row values (a unique violation names the address), so no
 * message is trusted to be free of personal data just because we wrote part of it.
 */
export function scrubMessage(text: string): string {
  const flat = text
    .replace(/[^\s@'"()<>,;:=]+@[^\s@'"()<>,;:=]+/g, '[email]')
    .replace(/\s+/g, ' ')
    .trim();
  return flat.length > MAX_MESSAGE_LENGTH ? `${flat.slice(0, MAX_MESSAGE_LENGTH)}...` : flat;
}

function causeCode(cause: unknown): string | undefined {
  if (typeof cause !== 'object' || cause === null) return undefined;
  const code = (cause as { code?: unknown }).code;
  return typeof code === 'string' ? code : undefined;
}

function isConnectionFailure(cause: unknown): boolean {
  const code = causeCode(cause);
  if (code !== undefined && CONNECTION_CODES.has(code)) return true;

  // pg reports a dropped or timed-out connection with no code at all.
  const text = cause instanceof Error ? cause.message : '';
  return /connection terminated|timeout exceeded when trying to connect/i.test(text);
}

/**
 * Map a thrown sign-up failure to one reason and a log-safe message.
 *
 * `query()` in `src/db/client.ts` wraps every database failure as INTERNAL_ERROR
 * with the driver's error as `cause` and the SQL text in `context`, so the reason
 * is read from the cause, not from the code alone.
 */
export function describeSignUpFailure(error: unknown): SignUpFailure {
  const appError = toAppError(error);
  const { code, cause, context } = appError;
  const causeText = cause instanceof Error ? cause.message : appError.message;

  if (isConnectionFailure(cause)) {
    return { reason: 'DATABASE_UNREACHABLE', code, message: scrubMessage(causeText) };
  }

  if ('sql' in context) {
    return { reason: 'DATABASE_ERROR', code, message: scrubMessage(causeText) };
  }

  if (code === 'DEPENDENCY_UNAVAILABLE') {
    return { reason: 'DATABASE_UNREACHABLE', code, message: scrubMessage(appError.message) };
  }

  if (code === 'VALIDATION_ERROR') {
    return { reason: 'VALIDATION', code, message: scrubMessage(appError.message) };
  }

  if (code === 'CONFLICT') {
    return { reason: 'EMAIL_ALREADY_REGISTERED', code, message: scrubMessage(appError.message) };
  }

  // Only the email service sets `provider` on a configuration error.
  if (code === 'CONFIGURATION_ERROR' && 'provider' in context) {
    return { reason: 'EMAIL_NOT_CONFIGURED', code, message: scrubMessage(appError.message) };
  }

  return { reason: 'UNKNOWN', code, message: scrubMessage(appError.message) };
}

/**
 * The log-safe form of why the verification mail did not go out.
 *
 * `null` means the auth service recorded no reason, which should not happen; it
 * is still logged rather than silently skipped.
 */
export function describeUnsentVerification(error: AppError | null): {
  code: string;
  message: string;
} {
  if (!error) return { code: 'UNKNOWN', message: 'no reason was recorded' };
  return { code: error.code, message: scrubMessage(error.message) };
}
