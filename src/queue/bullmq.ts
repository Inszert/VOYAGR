import { createHash } from 'node:crypto';
import type { ConnectionOptions, Job as BullJob, Queue, Worker } from 'bullmq';
import { getEnv } from '@/lib/env';
import { AppError } from '@/lib/errors';
import { getLogger } from '@/lib/logger';
import {
  JOB_NAMES,
  type EnqueueOptions,
  type Job,
  type JobHandler,
  type JobName,
  type JobPayloads,
  type QueueDriver,
  type QueueStats,
} from './types';

/**
 * BullMQ queue driver.
 *
 * The durable sibling of `memory.ts`. Both satisfy `QueueDriver`, so the
 * scheduler, the worker and every test above this line are identical whichever
 * is running - which is what makes "develop against memory, deploy against
 * Redis" honest rather than a hope.
 *
 * One queue holds every job name. BullMQ dispatches by name within a queue, and
 * one queue means one connection pair, one place to pause and one set of
 * metrics instead of five of each.
 *
 * `bullmq` is imported dynamically for the same reason `pg` is: nothing that
 * never enqueues a job should pay to load a Redis client, and `next build` must
 * not need one.
 */

const log = getLogger('queue.bullmq');

/** One queue, dispatching by job name. */
export const DEFAULT_QUEUE_NAME = 'voyagr';

/**
 * BullMQ requires this to be null on a worker connection: a blocking command
 * that gives up mid-wait loses the job it was holding.
 */
const CONNECTION_DEFAULTS = { maxRetriesPerRequest: null } as const;

/** Marks a failure as not worth retrying. */
class UnrecoverableJobError extends Error {
  constructor(message: string) {
    super(message);
    // BullMQ recognises this name and stops retrying.
    this.name = 'UnrecoverableError';
  }
}

/**
 * Turn a dedupe key into something BullMQ will accept as a job id.
 *
 * BullMQ rejects a colon outright - it separates its own Redis key segments
 * with one - and our keys are natural to write with colons and ISO timestamps,
 * which are full of them. Hashing rather than stripping keeps the mapping
 * injective: replacing every colon with a dash would let two genuinely
 * different keys collide and silently drop one caller's job.
 *
 * The job name is kept in front so a queue inspected in Redis still says what
 * the job is without anyone having to reverse a hash.
 */
export function toJobId(name: JobName, dedupeKey: string): string {
  return `${name}-${createHash('sha256').update(dedupeKey).digest('hex').slice(0, 16)}`;
}

function toJob(job: BullJob): Job {
  const name = job.name as JobName;

  if (!JOB_NAMES.includes(name)) {
    throw new UnrecoverableJobError(`Unknown job name ${job.name}`);
  }

  return {
    id: String(job.id ?? ''),
    name,
    payload: job.data as JobPayloads[JobName],
    // BullMQ counts attempts already made; the contract counts this attempt.
    attempt: (job.attemptsMade ?? 0) + 1,
    enqueuedAt: new Date(job.timestamp).toISOString(),
  };
}

export class BullMqQueueDriver implements QueueDriver {
  readonly name = 'bullmq' as const;

  private readonly handlers = new Map<JobName, JobHandler>();
  private readonly redisUrl: string;
  private readonly concurrency: number;

  private queue: Queue | undefined;
  private worker: Worker | undefined;
  private started = false;

  /** Overridable so a test cannot consume jobs from a running worker. */
  private readonly queueName: string;

  constructor(redisUrl: string, options: { concurrency?: number; queueName?: string } = {}) {
    this.redisUrl = redisUrl;
    this.concurrency = options.concurrency ?? 4;
    this.queueName = options.queueName ?? DEFAULT_QUEUE_NAME;
  }

  private connection(): ConnectionOptions {
    return { url: this.redisUrl, ...CONNECTION_DEFAULTS } as ConnectionOptions;
  }

  private async openQueue(): Promise<Queue> {
    if (this.queue) return this.queue;

    const { Queue: BullQueue } = await import('bullmq');

    this.queue = new BullQueue(this.queueName, {
      connection: this.connection(),
      defaultJobOptions: {
        attempts: 3,
        // Exponential, because a provider that just rate-limited us will still
        // be rate-limiting us a second later.
        backoff: { type: 'exponential', delay: 1000 },
        // A bounded history: enough to debug yesterday, not enough to fill
        // Redis with a year of successful refreshes.
        removeOnComplete: { count: 500 },
        removeOnFail: { count: 1000 },
      },
    });

    return this.queue;
  }

  register<TName extends JobName>(name: TName, handler: JobHandler<TName>): void {
    if (this.started) {
      throw new AppError('CONFIGURATION_ERROR', 'Handlers must be registered before start()', {
        publicMessage: 'Background jobs are not configured.',
      });
    }

    this.handlers.set(name, handler as JobHandler);
  }

  async enqueue<TName extends JobName>(
    name: TName,
    payload: JobPayloads[TName],
    options: EnqueueOptions = {},
  ): Promise<string> {
    const queue = await this.openQueue();

    // A BullMQ job id is unique, so reusing the dedupe key as the id *is* the
    // deduplication: enqueuing the same key while the first is still pending is
    // a no-op rather than a second identical refresh.
    const job = await queue.add(name, payload, {
      ...(options.delayMs ? { delay: options.delayMs } : {}),
      ...(options.attempts ? { attempts: options.attempts } : {}),
      ...(options.dedupeKey ? { jobId: toJobId(name, options.dedupeKey) } : {}),
    });

    return job.id ?? '';
  }

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;

    const { Worker: BullWorker } = await import('bullmq');

    this.worker = new BullWorker(
      this.queueName,
      async (job: BullJob) => {
        const handler = this.handlers.get(job.name as JobName);

        if (!handler) {
          // Not retryable: a job nobody handles will still have no handler in
          // thirty seconds, and retrying only delays the log entry.
          log.error({ jobName: job.name, jobId: job.id }, 'no handler registered for job');
          throw new UnrecoverableJobError(`No handler registered for ${job.name}`);
        }

        await handler(toJob(job));
      },
      { connection: this.connection(), concurrency: this.concurrency },
    );

    this.worker.on('failed', (job, error) => {
      log.error(
        { jobId: job?.id, jobName: job?.name, attempt: job?.attemptsMade, err: error },
        'job failed',
      );
    });

    // A worker-level error must not take the process down; it reconnects.
    this.worker.on('error', (error) => {
      log.error({ err: error }, 'queue worker error');
    });

    await this.worker.waitUntilReady();
    log.info(
      { concurrency: this.concurrency, handlers: [...this.handlers.keys()] },
      'queue worker started',
    );
  }

  async stop(): Promise<void> {
    this.started = false;

    // The worker closes first, so nothing new is picked up while the queue
    // connection is still open to finish what is in flight.
    await this.worker?.close();
    await this.queue?.close();

    this.worker = undefined;
    this.queue = undefined;
  }

  /**
   * Delete this queue and every job in it.
   *
   * Destructive and irreversible. For tests, which would otherwise leave a
   * queue behind on every run, and for an operator clearing a poisoned queue.
   * Never called by the application.
   */
  async obliterate(): Promise<void> {
    const queue = await this.openQueue();
    await queue.obliterate({ force: true });
  }

  async stats(): Promise<QueueStats> {
    const queue = await this.openQueue();
    const counts = await queue.getJobCounts('waiting', 'delayed', 'active', 'completed', 'failed');

    return {
      // Delayed jobs are pending: queued and certain to run, just not yet.
      pending: (counts.waiting ?? 0) + (counts.delayed ?? 0),
      active: counts.active ?? 0,
      completed: counts.completed ?? 0,
      failed: counts.failed ?? 0,
    };
  }

  /**
   * Wait until nothing is waiting or active.
   *
   * The in-process driver drains deterministically because it owns the whole
   * queue. This one cannot: other workers may consume the same Redis. It polls,
   * and gives up rather than hanging forever.
   */
  async drain(timeoutMs = 30_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;

    for (;;) {
      const { pending, active } = await this.stats();
      if (pending === 0 && active === 0) return;

      if (Date.now() > deadline) {
        throw new AppError('DEPENDENCY_UNAVAILABLE', 'Queue did not drain before the timeout', {
          context: { pending, active },
        });
      }

      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
}

export function createBullMqQueueDriver(): QueueDriver {
  const env = getEnv();

  if (!env.REDIS_URL) {
    throw new AppError('CONFIGURATION_ERROR', 'QUEUE_DRIVER=bullmq requires REDIS_URL', {
      publicMessage: 'Background jobs are not configured.',
    });
  }

  return new BullMqQueueDriver(env.REDIS_URL);
}
