import { describe, expect, it } from 'vitest';
import { AppError } from '@/lib/errors';
import { describeSignUpFailure, describeUnsentVerification, scrubMessage } from './sign-up-failure';

const socketError = (code: string, message: string) => Object.assign(new Error(message), { code });

describe('describeSignUpFailure', () => {
  it('maps a database connection refused behind the query wrapper to DATABASE_UNREACHABLE', () => {
    const error = new AppError('INTERNAL_ERROR', 'Database query failed', {
      cause: socketError('ECONNREFUSED', 'connect ECONNREFUSED 127.0.0.1:5432'),
      context: { sql: 'SELECT id FROM users WHERE email = $1' },
    });

    expect(describeSignUpFailure(error)).toEqual({
      reason: 'DATABASE_UNREACHABLE',
      code: 'INTERNAL_ERROR',
      message: 'connect ECONNREFUSED 127.0.0.1:5432',
    });
  });

  it('recognises a pg connection drop that has no error code', () => {
    const error = new AppError('INTERNAL_ERROR', 'Database query failed', {
      cause: new Error('Connection terminated unexpectedly'),
      context: { sql: 'SELECT 1' },
    });

    expect(describeSignUpFailure(error).reason).toBe('DATABASE_UNREACHABLE');
  });

  it('recognises a raw socket error that was never wrapped', () => {
    const error = socketError('ETIMEDOUT', 'connect ETIMEDOUT db.example:5432');

    expect(describeSignUpFailure(error)).toMatchObject({
      reason: 'DATABASE_UNREACHABLE',
      code: 'INTERNAL_ERROR',
    });
  });

  it('maps a query that reached the database and was refused to DATABASE_ERROR', () => {
    const error = new AppError('INTERNAL_ERROR', 'Database query failed', {
      cause: Object.assign(new Error('relation "users" does not exist'), { code: '42P01' }),
      context: { sql: 'INSERT INTO users ...' },
    });

    expect(describeSignUpFailure(error)).toEqual({
      reason: 'DATABASE_ERROR',
      code: 'INTERNAL_ERROR',
      message: 'relation "users" does not exist',
    });
  });

  it('treats a missing DATABASE_URL as the database being unreachable', () => {
    const error = new AppError('DEPENDENCY_UNAVAILABLE', 'DATABASE_URL is not set.');

    expect(describeSignUpFailure(error)).toEqual({
      reason: 'DATABASE_UNREACHABLE',
      code: 'DEPENDENCY_UNAVAILABLE',
      message: 'DATABASE_URL is not set.',
    });
  });

  it('maps a validation failure to VALIDATION', () => {
    const error = new AppError('VALIDATION_ERROR', 'Password below the minimum length');

    expect(describeSignUpFailure(error)).toEqual({
      reason: 'VALIDATION',
      code: 'VALIDATION_ERROR',
      message: 'Password below the minimum length',
    });
  });

  it('maps a taken address to EMAIL_ALREADY_REGISTERED', () => {
    const error = new AppError('CONFLICT', 'Email already registered');

    expect(describeSignUpFailure(error)).toMatchObject({
      reason: 'EMAIL_ALREADY_REGISTERED',
      code: 'CONFLICT',
    });
  });

  it('maps an email configuration error to EMAIL_NOT_CONFIGURED, using its provider context', () => {
    const error = new AppError(
      'CONFIGURATION_ERROR',
      'EMAIL_PROVIDER=resend needs RESEND_API_KEY to be set.',
      {
        context: { provider: 'resend' },
      },
    );

    expect(describeSignUpFailure(error)).toEqual({
      reason: 'EMAIL_NOT_CONFIGURED',
      code: 'CONFIGURATION_ERROR',
      message: 'EMAIL_PROVIDER=resend needs RESEND_API_KEY to be set.',
    });
  });

  it('does not call a configuration error with no provider context an email problem', () => {
    const error = new AppError('CONFIGURATION_ERROR', 'Something else is misconfigured');

    expect(describeSignUpFailure(error).reason).toBe('UNKNOWN');
  });

  it('maps anything else, including non-Error throws, to UNKNOWN', () => {
    expect(describeSignUpFailure('boom')).toEqual({
      reason: 'UNKNOWN',
      code: 'INTERNAL_ERROR',
      message: 'boom',
    });
    expect(describeSignUpFailure(new AppError('RATE_LIMITED', 'Sign-in throttled')).reason).toBe(
      'UNKNOWN',
    );
  });

  it('removes email addresses from driver messages that quote a row', () => {
    const error = new AppError('INTERNAL_ERROR', 'Database query failed', {
      cause: Object.assign(
        new Error('duplicate key value violates unique constraint "users_email_key"'),
        { code: '23505' },
      ),
      context: { sql: 'INSERT INTO users ...' },
    });

    const failure = describeSignUpFailure(error);

    expect(failure.message).not.toContain('@');
    expect(failure.message).toContain('users_email_key');
  });
});

describe('scrubMessage', () => {
  it('replaces every email-shaped token', () => {
    expect(scrubMessage('Key (email)=(a@example.com) and b@x.io exist')).toBe(
      'Key (email)=([email]) and [email] exist',
    );
  });

  it('collapses whitespace and caps the length', () => {
    expect(scrubMessage('  one\n\ntwo  ')).toBe('one two');
    const long = scrubMessage('x'.repeat(1000));
    expect(long.length).toBe(303);
    expect(long.endsWith('...')).toBe(true);
  });
});

describe('describeUnsentVerification', () => {
  it('returns the provider reason with its code, scrubbed', () => {
    const error = new AppError(
      'CONFIGURATION_ERROR',
      'Email not sent to a@example.com: RESEND_API_KEY missing',
    );

    expect(describeUnsentVerification(error)).toEqual({
      code: 'CONFIGURATION_ERROR',
      message: 'Email not sent to [email]: RESEND_API_KEY missing',
    });
  });

  it('says no reason was recorded rather than inventing one', () => {
    expect(describeUnsentVerification(null)).toEqual({
      code: 'UNKNOWN',
      message: 'no reason was recorded',
    });
  });
});
