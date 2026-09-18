/**
 * Background job abstraction.
 *
 * Travel Watch monitoring (specification section 17) is the product's core
 * differentiator, and it runs on a queue. This module defines the contract;
 * `memory.ts` implements it in-process and `bullmq.ts` implements it on Redis.
 *
 * The in-process driver is the default, so the whole monitoring loop can be
 * built and tested before Redis exists anywhere.
 */

/** Job names. A closed union so a typo is a compile error, not a lost job. */
export const JOB_NAMES = [
  /** Re-run one Travel Watch and record what it finds. */
  'travel-watch.refresh',
  /** Scan for watches that are due and enqueue a refresh for each. */
  'travel-watch.schedule',
  /** Compare a fresh result against history and decide whether to alert. */
  'deal.detect',
  /** Deliver a queued notification over its channel. */
  'notification.deliver',
  /** Probe every provider and record health. */
  'provider.health-check',
] as const;

export type JobName = (typeof JOB_NAMES)[number];

/** Payload shape for each job. */
export interface JobPayloads {
  'travel-watch.refresh': { watchId: string; reason: 'scheduled' | 'manual' | 'price-alert' };
  'travel-watch.schedule': { limit: number };
  'deal.detect': { watchId: string; candidateId: string };
  'notification.deliver': { notificationId: string };
  'provider.health-check': Record<string, never>;
}

export interface Job<TName extends JobName = JobName> {
  readonly id: string;
  readonly name: TName;
  readonly payload: JobPayloads[TName];
  readonly attempt: number;
  readonly enqueuedAt: string;
}

export interface EnqueueOptions {
  /** Delay before the job becomes runnable, in milliseconds. */
  readonly delayMs?: number;
  /** Maximum attempts including the first. Defaults to 3. */
  readonly attempts?: number;
  /**
   * Deduplication key. Enqueuing the same key twice while one is pending is a
   * no-op, which keeps a burst of user actions from queueing duplicate refreshes.
   */
  readonly dedupeKey?: string;
}

export type JobHandler<TName extends JobName = JobName> = (job: Job<TName>) => Promise<void>;

export interface QueueStats {
  readonly pending: number;
  readonly active: number;
  readonly completed: number;
  readonly failed: number;
}

export interface QueueDriver {
  readonly name: 'memory' | 'bullmq';

  enqueue<TName extends JobName>(
    name: TName,
    payload: JobPayloads[TName],
    options?: EnqueueOptions,
  ): Promise<string>;

  /** Register the handler for a job name. One handler per name. */
  register<TName extends JobName>(name: TName, handler: JobHandler<TName>): void;

  /** Begin processing. Idempotent. */
  start(): Promise<void>;

  /** Stop processing and release resources. */
  stop(): Promise<void>;

  stats(): Promise<QueueStats>;

  /**
   * Run every currently-pending job to completion.
   *
   * Present on the interface because tests need a deterministic way to drain the
   * queue instead of sleeping and hoping. The Redis driver waits for the
   * in-flight set to empty.
   */
  drain(): Promise<void>;
}
