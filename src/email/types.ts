import type { AppError } from '@/lib/errors';
import type { Result } from '@/lib/result';

/**
 * Email adapter contract.
 *
 * Mirrors `src/providers/types.ts`: feature code depends on this interface,
 * never on a vendor SDK, so adding a real provider later is an adapter change
 * and nothing more. `send` returns a `Result` rather than throwing, because a
 * failed email must degrade the feature that sent it (a sign-up still
 * succeeds; the user just does not get a verification link yet), not abort
 * it.
 */
export interface EmailMessage {
  readonly to: string;
  readonly subject: string;
  /** Always present: the text alternative is what a client that blocks HTML shows. */
  readonly text: string;
  readonly html?: string;
  /**
   * Extra message headers, for `List-Unsubscribe` and its `-Post` companion.
   * A provider that cannot carry headers must say so by failing, not by
   * dropping them - a bulk message without them is a compliance defect.
   */
  readonly headers?: Readonly<Record<string, string>>;
}

export interface EmailProvider {
  readonly id: string;
  /** True only for a provider that actually delivers mail outside this process. */
  readonly sendsRealEmail: boolean;
  send(message: EmailMessage): Promise<Result<void, AppError>>;
}
