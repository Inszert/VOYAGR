import { getEnv } from '@/lib/env';
import { getLogger } from '@/lib/logger';
import { createMemoryRepositories } from './memory';
import type { Repositories } from './repository';

/**
 * Repository factory.
 *
 * Selects a persistence backend from configuration. With `DATABASE_URL` unset -
 * the default for the foundation - this hands back in-memory repositories and
 * no database driver is ever loaded.
 *
 * A Postgres implementation slots in here once the schema in
 * `src/db/migrations/` is applied; nothing above this line changes.
 */

const log = getLogger('db.factory');

let repositories: Repositories | undefined;

export function getRepositories(): Repositories {
  if (!repositories) {
    const env = getEnv();

    if (env.DATABASE_URL) {
      // A Postgres implementation of `Repositories` is the next step here. Until
      // it exists, warn loudly rather than pretending the data is persistent.
      log.warn(
        'DATABASE_URL is set but the Postgres repositories are not implemented yet; using in-memory storage.',
      );
    }

    repositories = createMemoryRepositories();
    log.info({ backend: repositories.backend }, 'repositories initialised');
  }

  return repositories;
}

/** Test helper - drops the cached repositories so each test starts clean. */
export function resetRepositories(): void {
  repositories = undefined;
}

export { createMemoryRepositories } from './memory';
export * from './repository';
export {
  checkDatabaseHealth,
  closePool,
  isDatabaseConfigured,
  query,
  withTransaction,
} from './client';
