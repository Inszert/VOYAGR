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
  /** Deliver a queued notification over its channel. */
  'notification.deliver',
  /**
   * Re-price one cache target, or pre-warm one destination's things to do
   * (`places:<code>`), so pages read instead of call.
   */
  'cache.refresh',
  /** Refresh one LiteAPI destination and date window into our own snapshot tables. */
  'liteapi.snapshot.refresh',
  /** Refresh one LiteAPI origin, destination and date window of flights into our own snapshot. */
  'liteapi.flights.refresh',
] as const;

/*
 * Every name above has a handler registered by `src/worker/main.ts`, and a test
 * holds it to that. Deal detection runs inside the watch refresh and watches
 * are found by the scheduler's sweep (`src/watches/scheduler.ts`), so neither is
 * a job of its own; add a name here only together with the code that enqueues it.
 */

export type JobName = (typeof JOB_NAMES)[number];

/** Payload shape for each job. */
export interface JobPayloads {
  'travel-watch.refresh': { watchId: string; reason: 'scheduled' | 'manual' | 'price-alert' };
  'notification.deliver': { notificationId: string };
  'cache.refresh': { targetId: string };
  'liteapi.snapshot.refresh': { destination: string; checkIn: string; checkOut: string };
  'liteapi.flights.refresh': {
    origin: string;
    destination: string;
    departureDate: string;
    returnDate: string;
  };
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
   * no-op, which keeps a burst of user actions from queueing duplicate
   * refreshes.
   *
   * Opaque: a driver may encode it however its backend requires. BullMQ, for
   * one, refuses a job id containing a colon, so the key is hashed rather than
   * used verbatim. Never parse a key back out of a job id.
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
