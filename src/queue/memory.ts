import { randomUUID } from 'node:crypto';
import { getLogger } from '@/lib/logger';
import { toLogPayload } from '@/lib/errors';
import type {
  EnqueueOptions,
  Job,
  JobHandler,
  JobName,
  JobPayloads,
  QueueDriver,
  QueueStats,
} from './types';

/**
 * In-process queue driver.
 *
 * The default, and the reason Redis is not required to develop the Travel Watch
 * loop. It implements the same contract as the Redis driver - retries, delays,
 * deduplication - so code written against it behaves the same once BullMQ takes
 * over.
 *
 * What it is not: durable. Jobs live in memory and are lost on restart, and it
 * does not distribute across processes. It is a development and test driver.
 */

const log = getLogger('queue.memory');

interface PendingJob {
  job: Job;
  runAt: number;
  maxAttempts: number;
  dedupeKey?: string;
}

/** Exponential backoff between retries, capped so tests stay fast. */
function backoffMs(attempt: number): number {
  return Math.min(30_000, 2 ** (attempt - 1) * 250);
}

export class MemoryQueueDriver implements QueueDriver {
  readonly name = 'memory' as const;

  private readonly handlers = new Map<JobName, JobHandler<never>>();
  private readonly pending: PendingJob[] = [];
  private readonly dedupeKeys = new Set<string>();
  private active = 0;
  private completed = 0;
  private failed = 0;
  private running = false;
  private timer: NodeJS.Timeout | undefined;

  /** How often the driver looks for runnable jobs. */
  constructor(private readonly tickMs = 25) {}

  async enqueue<TName extends JobName>(
    name: TName,
    payload: JobPayloads[TName],
    options: EnqueueOptions = {},
  ): Promise<string> {
    if (options.dedupeKey && this.dedupeKeys.has(options.dedupeKey)) {
      log.debug({ name, dedupeKey: options.dedupeKey }, 'duplicate job suppressed');
      return options.dedupeKey;
    }

    const job: Job<TName> = {
      id: randomUUID(),
      name,
      payload,
      attempt: 1,
      enqueuedAt: new Date().toISOString(),
    };

    this.pending.push({
      job: job as Job,
      runAt: Date.now() + (options.delayMs ?? 0),
      maxAttempts: options.attempts ?? 3,
      ...(options.dedupeKey ? { dedupeKey: options.dedupeKey } : {}),
    });

    if (options.dedupeKey) this.dedupeKeys.add(options.dedupeKey);

    log.debug({ name, jobId: job.id, delayMs: options.delayMs ?? 0 }, 'job enqueued');

    return job.id;
  }

  register<TName extends JobName>(name: TName, handler: JobHandler<TName>): void {
    if (this.handlers.has(name)) {
      log.warn({ name }, 'replacing an existing job handler');
    }
    this.handlers.set(name, handler as JobHandler<never>);
  }

  async start(): Promise<void> {
    if (this.running) return;

    this.running = true;
    // `unref` so a running queue never keeps a CLI process or test alive.
    this.timer = setInterval(() => void this.tick(), this.tickMs);
    this.timer.unref?.();

    log.info('in-process queue started');
  }

  async stop(): Promise<void> {
    this.running = false;

    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }

    log.info('in-process queue stopped');
  }

  async stats(): Promise<QueueStats> {
    return {
      pending: this.pending.length,
      active: this.active,
      completed: this.completed,
      failed: this.failed,
    };
  }

  /**
   * Run every runnable job until none remain.
   *
   * Delayed jobs whose time has not come are left alone, so a test can assert on
   * a backoff without waiting for it.
   */
  async drain(): Promise<void> {
    // Bounded rather than `while (true)`: a handler that re-enqueues itself
    // must not spin forever.
    for (let pass = 0; pass < 1000; pass += 1) {
      const runnable = this.takeRunnable();
      if (runnable.length === 0) return;

      await Promise.all(runnable.map((entry) => this.run(entry)));
    }

    log.warn('drain() hit its pass limit; a handler is probably re-enqueuing itself');
  }

  private takeRunnable(): PendingJob[] {
    const now = Date.now();
    const runnable: PendingJob[] = [];

    for (let index = this.pending.length - 1; index >= 0; index -= 1) {
      const entry = this.pending[index];
      if (entry && entry.runAt <= now) {
        runnable.push(entry);
        this.pending.splice(index, 1);
      }
    }

    return runnable.reverse();
  }

  private async tick(): Promise<void> {
    if (!this.running) return;

    const runnable = this.takeRunnable();
    if (runnable.length === 0) return;

    await Promise.all(runnable.map((entry) => this.run(entry)));
  }

  private async run(entry: PendingJob): Promise<void> {
    const handler = this.handlers.get(entry.job.name);

    if (!handler) {
      log.error(
        { name: entry.job.name, jobId: entry.job.id },
        'no handler registered; job dropped',
      );
      this.failed += 1;
      this.releaseDedupe(entry);
      return;
    }

    this.active += 1;

    try {
      await (handler as JobHandler)(entry.job);
      this.completed += 1;
      this.releaseDedupe(entry);
      log.debug({ name: entry.job.name, jobId: entry.job.id }, 'job completed');
    } catch (error) {
      const nextAttempt = entry.job.attempt + 1;

      if (nextAttempt > entry.maxAttempts) {
        this.failed += 1;
        this.releaseDedupe(entry);
        log.error(
          {
            name: entry.job.name,
            jobId: entry.job.id,
            attempts: entry.job.attempt,
            err: toLogPayload(error),
          },
          'job failed permanently',
        );
        return;
      }

      // Re-queue with backoff, preserving the deduplication key so a retrying
      // job still suppresses duplicates.
      this.pending.push({
        ...entry,
        job: { ...entry.job, attempt: nextAttempt },
        runAt: Date.now() + backoffMs(entry.job.attempt),
      });

      log.warn(
        { name: entry.job.name, jobId: entry.job.id, attempt: entry.job.attempt },
        'job failed; scheduled for retry',
      );
    } finally {
      this.active -= 1;
    }
  }

  private releaseDedupe(entry: PendingJob): void {
    if (entry.dedupeKey) this.dedupeKeys.delete(entry.dedupeKey);
  }
}

export function createMemoryQueueDriver(tickMs?: number): QueueDriver {
  return new MemoryQueueDriver(tickMs);
}
