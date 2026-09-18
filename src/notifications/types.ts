/**
 * Notification abstraction.
 *
 * Web Push is the first channel (specification section 18, and the setup
 * checklist's notification-priority decision), but the product will grow email
 * and possibly SMS. Feature code therefore targets `NotificationChannel`, never
 * a specific transport.
 *
 * Severity is a deterministic decision made by the deal detector, not by the
 * model. The model may only word an alert that something else decided to send.
 */

export type NotificationSeverity =
  /** The user should probably act. */
  | 'important'
  /** A meaningful improvement, but not urgent. */
  | 'interesting'
  /** Useful to know, no action implied. */
  | 'fyi';

export interface NotificationPayload {
  readonly severity: NotificationSeverity;
  readonly title: string;
  readonly body: string;
  /** Where tapping the notification should land. Relative to the app origin. */
  readonly url: string;
  /** Groups related alerts so a watch cannot stack up five notifications. */
  readonly tag?: string;
  readonly data?: Record<string, string | number | boolean>;
}

export interface DeliveryTarget {
  readonly userId: string;
}

export type DeliveryStatus = 'delivered' | 'skipped' | 'failed' | 'expired';

export interface DeliveryResult {
  readonly channel: string;
  readonly status: DeliveryStatus;
  /** Number of individual endpoints reached, for multi-device users. */
  readonly recipients: number;
  readonly message?: string;
}

export interface NotificationChannel {
  readonly id: string;
  readonly displayName: string;

  /** Whether configuration allows this channel to send at all right now. */
  isConfigured(): boolean;

  /**
   * Deliver a payload.
   *
   * Must not throw for ordinary delivery failures - an unreachable endpoint is
   * an expected outcome, and one dead subscription must not abort a batch.
   */
  send(target: DeliveryTarget, payload: NotificationPayload): Promise<DeliveryResult>;
}
