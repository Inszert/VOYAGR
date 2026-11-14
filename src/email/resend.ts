import { AppError } from '@/lib/errors';
import { getLogger } from '@/lib/logger';
import { err, ok } from '@/lib/result';
import type { EmailMessage, EmailProvider } from './types';

/**
 * Resend, over plain HTTPS.
 *
 * No SDK: one POST is the whole integration, and a dependency that wraps it
 * adds a version to track and nothing to read. Failures come back as a
 * `Result`, because a mail that did not go out must degrade the feature that
 * sent it, never abort it.
 *
 * What is logged: the HTTP status and Resend's message id. Never the API key,
 * the recipient, the subject or the body - a verification or reset link in a
 * log is a working credential, and the recipient is personal data. Resend's
 * own error text is also left out of the log, since it can echo the address.
 */

const log = getLogger('email.resend');

const ENDPOINT = 'https://api.resend.com/emails';

/** Long enough for a slow day at the vendor, short enough that a request does not hang on it. */
const DEFAULT_TIMEOUT_MS = 10_000;

export interface ResendEmailOptions {
  readonly apiKey: string;
  readonly from: string;
  readonly replyTo?: string;
  readonly timeoutMs?: number;
  /** Injectable so a test can answer without a network. */
  readonly fetch?: typeof fetch;
}

export class ResendEmailProvider implements EmailProvider {
  readonly id = 'resend';
  readonly sendsRealEmail = true;

  private readonly options: ResendEmailOptions;

  constructor(options: ResendEmailOptions) {
    this.options = options;
  }

  async send(message: EmailMessage): ReturnType<EmailProvider['send']> {
    const { apiKey, from, replyTo, timeoutMs = DEFAULT_TIMEOUT_MS } = this.options;
    const doFetch = this.options.fetch ?? fetch;

    const body = {
      from,
      to: [message.to],
      subject: message.subject,
      text: message.text,
      ...(message.html === undefined ? {} : { html: message.html }),
      ...(replyTo === undefined ? {} : { reply_to: replyTo }),
      ...(message.headers && Object.keys(message.headers).length > 0
        ? { headers: message.headers }
        : {}),
    };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await doFetch(ENDPOINT, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (response.ok) {
        const parsed = (await response.json().catch(() => null)) as { id?: unknown } | null;
        log.info({ status: response.status, messageId: parsed?.id }, 'email accepted');
        return ok(undefined);
      }

      log.warn({ status: response.status }, 'email rejected by provider');

      // 429 and 5xx are the vendor's state and may pass; any other 4xx is a
      // fault in what we sent or in our key, and sending it again changes nothing.
      const transient = response.status === 429 || response.status >= 500;

      return err(
        new AppError(
          response.status === 429
            ? 'RATE_LIMITED'
            : transient
              ? 'PROVIDER_UNAVAILABLE'
              : 'PROVIDER_ERROR',
          `Resend answered ${response.status}`,
          { context: { provider: this.id, status: response.status }, retryable: transient },
        ),
      );
    } catch (error) {
      const aborted = error instanceof Error && error.name === 'AbortError';
      log.warn({ aborted }, 'email request failed');

      return err(
        new AppError(
          aborted ? 'PROVIDER_TIMEOUT' : 'PROVIDER_UNAVAILABLE',
          aborted ? 'Resend did not answer in time' : 'Resend could not be reached',
          // The cause is a network error; it carries no body or key.
          { context: { provider: this.id }, cause: error },
        ),
      );
    } finally {
      clearTimeout(timer);
    }
  }
}

export function createResendEmailProvider(options: ResendEmailOptions): EmailProvider {
  return new ResendEmailProvider(options);
}
