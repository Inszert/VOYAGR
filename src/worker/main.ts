import { getEnv } from '@/lib/env';
import { getLogger } from '@/lib/logger';
import { getRepositories } from '@/db';
import { createQueueDriver } from '@/queue';
import { createRefreshHandler } from '@/watches/refresh';
import { createDeliveryHandler } from '@/notifications/deliver';
import { startScheduler, sweepDueWatches, type SchedulerHandle } from '@/watches/scheduler';
import { startMaintenance, type MaintenanceHandle, type MaintenanceOptions } from './maintenance';
import type { QueueDriver } from '@/queue/types';

/**
 * The background worker.
 *
 * Two jobs in one process: a scheduler that notices which watches are due, and
 * a consumer that refreshes them. They are separate concerns joined by the
 * queue, so splitting them into two processes later is a deployment change
 * rather than a code change.
 *
 * Deliberately a plain Node entry point rather than anything Next-specific. A
 * worker has no request, no response and no rendering, and running it inside
 * the web server would tie the monitoring loop's uptime to the website's.
 */

const log = getLogger('worker.main');

export interface WorkerHandle {
  readonly queue: QueueDriver;
  readonly scheduler: SchedulerHandle;
  readonly maintenance: MaintenanceHandle;
  stop(): Promise<void>;
}

export interface WorkerOptions {
  /** How often to look for due watches. Not how often a watch runs. */
  readonly schedulerIntervalMs?: number;
  /** Sweep once immediately, so a restart picks up what is already overdue. */
  readonly sweepOnStart?: boolean;
  readonly maintenance?: MaintenanceOptions;
}

export async function startWorker(options: WorkerOptions = {}): Promise<WorkerHandle> {
  const repositories = getRepositories();
  const queue = createQueueDriver();

  queue.register('travel-watch.refresh', createRefreshHandler({ repositories, queue }));
  queue.register('notification.deliver', createDeliveryHandler({ repositories }));

  await queue.start();

  // A restart must not wait a full interval before noticing work that fell due
  // while the process was down.
  if (options.sweepOnStart !== false) {
    const swept = await sweepDueWatches({ repositories, queue });
    log.info({ ...swept }, 'initial sweep complete');
  }

  const scheduler = startScheduler(
    { repositories, queue },
    { intervalMs: options.schedulerIntervalMs },
  );

  // Housekeeping lives with the worker because it is the only process that is
  // supposed to be long-running. Putting it in the web server would mean it
  // ran once per instance, or not at all on a serverless one.
  const maintenance = startMaintenance({ repositories }, options.maintenance);

  log.info({ queue: queue.name, backend: repositories.backend }, 'worker started');

  return {
    queue,
    scheduler,
    maintenance,
    async stop() {
      scheduler.stop();
      maintenance.stop();
      await queue.stop();
      log.info('worker stopped');
    },
  };
}

/**
 * Run as a process.
 *
 * Kept out of `startWorker` so a test can start and stop a worker without
 * installing signal handlers or ending the process.
 */
export async function runWorkerProcess(): Promise<void> {
  const env = getEnv();

  if (env.QUEUE_DRIVER === 'memory') {
    // Worth saying out loud: an in-process queue inside a standalone worker
    // means the website enqueues into a queue this process cannot see.
    log.warn(
      'QUEUE_DRIVER=memory: this worker has its own in-process queue and shares nothing with the web server. Set QUEUE_DRIVER=bullmq.',
    );
  }

  const worker = await startWorker();
  let stopping = false;

  const shutdown = (signal: string) => {
    if (stopping) return;
    stopping = true;

    log.info({ signal }, 'shutting down');

    // In-flight jobs are allowed to finish; BullMQ returns anything unfinished
    // to the queue, so a restart resumes rather than loses work.
    void worker
      .stop()
      .catch((error: unknown) => log.error({ err: error }, 'shutdown failed'))
      .finally(() => process.exit(0));
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}
