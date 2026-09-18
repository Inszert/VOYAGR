import { describe, expect, it } from 'vitest';
import { AppError, isAppError, toAppError, toLogPayload, toProblemDetails } from './errors';

describe('AppError', () => {
  it('maps a code to an HTTP status', () => {
    expect(new AppError('NOT_FOUND', 'missing').status).toBe(404);
    expect(new AppError('RATE_LIMITED', 'slow down').status).toBe(429);
    expect(new AppError('PROVIDER_TIMEOUT', 'timed out').status).toBe(504);
  });

  it('defaults retryability from the code', () => {
    expect(new AppError('PROVIDER_TIMEOUT', 'x').retryable).toBe(true);
    expect(new AppError('VALIDATION_ERROR', 'x').retryable).toBe(false);
  });

  it('allows retryability to be overridden', () => {
    expect(new AppError('VALIDATION_ERROR', 'x', { retryable: true }).retryable).toBe(true);
  });

  it('supplies a generic public message when none is given', () => {
    const error = new AppError('PROVIDER_ERROR', 'Amadeus returned HTTP 500 with body {...}');

    expect(error.publicMessage).not.toContain('Amadeus');
    expect(error.publicMessage).toBeTruthy();
  });

  it('preserves the cause chain', () => {
    const cause = new Error('socket hang up');
    expect(new AppError('PROVIDER_ERROR', 'failed', { cause }).cause).toBe(cause);
  });
});

describe('toAppError', () => {
  it('passes an AppError through unchanged', () => {
    const original = new AppError('NOT_FOUND', 'missing');
    expect(toAppError(original)).toBe(original);
  });

  it('wraps a plain Error', () => {
    const wrapped = toAppError(new Error('boom'));

    expect(isAppError(wrapped)).toBe(true);
    expect(wrapped.code).toBe('INTERNAL_ERROR');
    expect(wrapped.message).toBe('boom');
  });

  it('wraps a non-Error throw', () => {
    expect(toAppError('a string was thrown').message).toBe('a string was thrown');
  });
});

describe('toProblemDetails', () => {
  it('exposes only the public message', () => {
    // The internal message routinely contains provider payloads and SQL.
    const error = new AppError('PROVIDER_ERROR', 'upstream said: {"key":"sk-live-123"}', {
      publicMessage: 'A travel data provider is having trouble.',
      context: { providerKey: 'sk-live-123' },
    });

    const problem = toProblemDetails(error);
    const serialised = JSON.stringify(problem);

    expect(problem.detail).toBe('A travel data provider is having trouble.');
    expect(serialised).not.toContain('sk-live-123');
  });

  it('omits context, cause and stack entirely', () => {
    const problem = toProblemDetails(
      new AppError('INTERNAL_ERROR', 'internal', { context: { userId: 'u1' } }),
    );

    expect(problem).not.toHaveProperty('context');
    expect(problem).not.toHaveProperty('stack');
    expect(problem).not.toHaveProperty('cause');
  });

  it('includes a request id when one is supplied', () => {
    expect(toProblemDetails(new AppError('NOT_FOUND', 'x'), 'req-42').requestId).toBe('req-42');
  });

  it('builds a stable type URI from the code', () => {
    expect(toProblemDetails(new AppError('RATE_LIMITED', 'x')).type).toContain('rate-limited');
  });
});

describe('toLogPayload', () => {
  it('keeps the detail that is withheld from clients', () => {
    // The information has to go somewhere: logs get it, users do not.
    const payload = toLogPayload(
      new AppError('PROVIDER_ERROR', 'upstream 500', { context: { provider: 'mock-flights' } }),
    );

    expect(payload.message).toBe('upstream 500');
    expect(payload.context).toEqual({ provider: 'mock-flights' });
    expect(payload.stack).toBeTruthy();
  });
});
