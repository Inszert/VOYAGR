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

/**
 * Cached on `globalThis`, not a plain module-level `let`.
 *
 * **Found the hard way, not assumed.** A plain top-level `let` here is not
 * actually process-wide under Next.js's App Router: a Route Handler can be
 * compiled and run as a separate module instance from Server Components and
 * Server Actions, and each instance gets its *own* copy of a module-level
 * variable - the "repositories initialised" log line was observed firing a
 * second time for a single request, each time wiping `repositories` back to
 * `undefined` and handing a Route Handler a brand new, empty in-memory
 * store, while the account a Server Action had just created a moment
 * earlier lived in the first instance's store. Reproduced in both `next
 * dev` and the production Turbopack build. `globalThis` is the standard fix
 * for exactly this class of problem - it is the same reason Prisma's own
 * Next.js guide tells you to cache a client on `globalThis` rather than a
 * module-level variable. Harmless once `DATABASE_URL` is set, because then
 * the real state lives in Postgres, outside any Node module instance - this
 * only ever mattered for the in-memory backend, which is also exactly the
 * zero-configuration path this project's own quick start promotes.
 */
declare global {
  var __voyagrRepositories: Repositories | undefined;
}

export function getRepositories(): Repositories {
  if (!globalThis.__voyagrRepositories) {
    const env = getEnv();

    const built = env.DATABASE_URL ? createPostgresRepositories() : createMemoryRepositories();

    if (!env.DATABASE_URL) {
      // Said plainly on every boot. Silently running on memory in something
      // that looks like production is how data disappears without anyone
      // noticing until it matters.
      log.warn('DATABASE_URL is not set; using in-memory storage, which is lost on restart.');
    }

    log.info({ backend: built.backend }, 'repositories initialised');
    globalThis.__voyagrRepositories = built;
  }

  return globalThis.__voyagrRepositories;
}

/** Test helper - drops the cached repositories so each test starts clean. */
export function resetRepositories(): void {
  globalThis.__voyagrRepositories = undefined;
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
