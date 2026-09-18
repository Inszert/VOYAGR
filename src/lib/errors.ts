/**
 * Application error taxonomy.
 *
 * Two rules drive the design:
 *  1. Every error carries a stable machine-readable `code`, so clients and logs
 *     can branch on it without string-matching a message.
 *  2. Errors distinguish what is safe to show a user (`publicMessage`) from what
 *     is only for logs (`cause`, `context`). Provider responses and connection
 *     strings must never reach the browser.
 */

export const ERROR_CODES = [
  'VALIDATION_ERROR',
  'NOT_FOUND',
  'UNAUTHORIZED',
  'FORBIDDEN',
  'CONFLICT',
  'RATE_LIMITED',
  'PROVIDER_ERROR',
  'PROVIDER_UNAVAILABLE',
  'PROVIDER_TIMEOUT',
  'AI_ERROR',
  'AI_GUARDRAIL_VIOLATION',
  'CONFIGURATION_ERROR',
  'DEPENDENCY_UNAVAILABLE',
  'INTERNAL_ERROR',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

const STATUS_BY_CODE: Record<ErrorCode, number> = {
  VALIDATION_ERROR: 400,
  NOT_FOUND: 404,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  PROVIDER_ERROR: 502,
  PROVIDER_UNAVAILABLE: 503,
  PROVIDER_TIMEOUT: 504,
  AI_ERROR: 502,
  AI_GUARDRAIL_VIOLATION: 422,
  CONFIGURATION_ERROR: 500,
  DEPENDENCY_UNAVAILABLE: 503,
  INTERNAL_ERROR: 500,
};

/** Generic text used when an error has no message that is safe to expose. */
const GENERIC_PUBLIC_MESSAGE: Record<ErrorCode, string> = {
  VALIDATION_ERROR: 'The request was not valid.',
  NOT_FOUND: 'The requested resource was not found.',
  UNAUTHORIZED: 'Authentication is required.',
  FORBIDDEN: 'You do not have access to this resource.',
  CONFLICT: 'The request conflicts with the current state.',
  RATE_LIMITED: 'Too many requests. Please try again shortly.',
  PROVIDER_ERROR: 'A travel data provider returned an unexpected response.',
  PROVIDER_UNAVAILABLE: 'A travel data provider is currently unavailable.',
  PROVIDER_TIMEOUT: 'A travel data provider did not respond in time.',
  AI_ERROR: 'The assistant could not complete that request.',
  AI_GUARDRAIL_VIOLATION: 'The assistant response failed validation and was discarded.',
  CONFIGURATION_ERROR: 'The service is not configured correctly.',
  DEPENDENCY_UNAVAILABLE: 'A required service is unavailable.',
  INTERNAL_ERROR: 'Something went wrong.',
};

export interface AppErrorOptions {
  /** Message safe to display to an end user. Defaults to a generic phrase. */
  publicMessage?: string;
  /** Structured, log-only detail. Never serialised into a client response. */
  context?: Record<string, unknown>;
  cause?: unknown;
  /** Whether a retry could plausibly succeed. */
  retryable?: boolean;
}

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly publicMessage: string;
  readonly context: Record<string, unknown>;
  readonly retryable: boolean;

  constructor(code: ErrorCode, message: string, options: AppErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'AppError';
    this.code = code;
    this.status = STATUS_BY_CODE[code];
    this.publicMessage = options.publicMessage ?? GENERIC_PUBLIC_MESSAGE[code];
    this.context = options.context ?? {};
    this.retryable =
      options.retryable ??
      (code === 'PROVIDER_TIMEOUT' ||
        code === 'PROVIDER_UNAVAILABLE' ||
        code === 'RATE_LIMITED' ||
        code === 'DEPENDENCY_UNAVAILABLE');
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}

/** Wrap an unknown thrown value into an AppError without losing the original. */
export function toAppError(error: unknown, fallbackCode: ErrorCode = 'INTERNAL_ERROR'): AppError {
  if (isAppError(error)) return error;

  const message = error instanceof Error ? error.message : String(error);
  return new AppError(fallbackCode, message, { cause: error });
}

/**
 * RFC 9457 style problem detail, safe to return as an HTTP response body.
 * Deliberately excludes `context`, `cause` and stack traces.
 */
export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  code: ErrorCode;
  detail: string;
  requestId?: string;
}

export function toProblemDetails(error: unknown, requestId?: string): ProblemDetails {
  const appError = toAppError(error);

  return {
    type: `https://voyagr.app/errors/${appError.code.toLowerCase().replaceAll('_', '-')}`,
    title: appError.code,
    status: appError.status,
    code: appError.code,
    detail: appError.publicMessage,
    ...(requestId ? { requestId } : {}),
  };
}

/** Log-shaped view of an error, including the detail withheld from clients. */
export function toLogPayload(error: unknown): Record<string, unknown> {
  const appError = toAppError(error);

  return {
    code: appError.code,
    status: appError.status,
    message: appError.message,
    retryable: appError.retryable,
    context: appError.context,
    stack: appError.stack,
    cause: appError.cause instanceof Error ? appError.cause.message : undefined,
  };
}
