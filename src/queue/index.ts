import { getEnv } from '@/lib/env';
import { AppError } from '@/lib/errors';
import { getLogger } from '@/lib/logger';
import { createMemoryQueueDriver } from './memory';
import type { QueueDriver } from './types';

/**
 * Queue factory.
 *
 * Chooses a driver from configuration. The default is the in-process driver, so
 * `npm run dev`, `npm test` and CI all work with no Redis anywhere.
 *
 * Selecting `bullmq` without a `REDIS_URL` is a hard error rather than a silent
 * downgrade: a production deployment that thought it had durable background jobs
 * and quietly got in-memory ones would lose every Travel Watch on restart.
 */

const log = getLogger('queue.factory');

export function createQueueDriver(): QueueDriver {
  const env = getEnv();

  if (env.QUEUE_DRIVER === 'bullmq') {
    if (!env.REDIS_URL) {
      throw new AppError(
        'CONFIGURATION_ERROR',
        'QUEUE_DRIVER=bullmq requires REDIS_URL to be set.',
        { publicMessage: 'Background jobs are not configured.' },
      );
    }

    // The BullMQ driver is the next step here. Until it exists, refuse rather
    // than pretend: see `docs/architecture.md` for the intended shape.
    throw new AppError(
      'CONFIGURATION_ERROR',
      'The BullMQ queue driver is not implemented yet. Set QUEUE_DRIVER=memory.',
      { publicMessage: 'Background jobs are not configured.' },
    );
  }

  return createMemoryQueueDriver();
}

let driver: QueueDriver | undefined;

export function getQueue(): QueueDriver {
  if (!driver) {
    driver = createQueueDriver();
    log.info({ driver: driver.name }, 'queue driver initialised');
  }
  return driver;
}

/** Test helper - drops the cached driver so each test gets a clean queue. */
export async function resetQueue(): Promise<void> {
  if (driver) await driver.stop();
  driver = undefined;
}

export { createMemoryQueueDriver, MemoryQueueDriver } from './memory';
export * from './types';
