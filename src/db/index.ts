import { getEnv } from '@/lib/env';
import { getLogger } from '@/lib/logger';
import { createMemoryRepositories } from './memory';
import { createPostgresRepositories } from './postgres';
import type { Repositories } from './repository';

/**
 * Repository factory.
 *
 * Selects a persistence backend from configuration. With `DATABASE_URL` unset -
 * still the default - this hands back in-memory repositories and no database
 * driver is ever loaded. With it set, the Postgres implementation is used and
 * nothing above this line changes, which was the point of the interface.
 *
 * The in-memory backend is a development and test backend, never a production
 * one: it loses everything when the process stops.
 */

const log = getLogger('db.factory');

let repositories: Repositories | undefined;

export function getRepositories(): Repositories {
  if (!repositories) {
    const env = getEnv();

    repositories = env.DATABASE_URL ? createPostgresRepositories() : createMemoryRepositories();

    if (!env.DATABASE_URL) {
      // Said plainly on every boot. Silently running on memory in something
      // that looks like production is how data disappears without anyone
      // noticing until it matters.
      log.warn('DATABASE_URL is not set; using in-memory storage, which is lost on restart.');
    }

    log.info({ backend: repositories.backend }, 'repositories initialised');
  }

  return repositories;
}

/** Test helper - drops the cached repositories so each test starts clean. */
export function resetRepositories(): void {
  repositories = undefined;
}

export { createMemoryRepositories } from './memory';
export { createPostgresRepositories } from './postgres';
export * from './repository';
export {
  checkDatabaseHealth,
  closePool,
  isDatabaseConfigured,
  query,
  withTransaction,
} from './client';
