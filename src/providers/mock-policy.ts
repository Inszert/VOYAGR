import type { Env } from '@/lib/env';

/**
 * Whether this process may serve fixtures at all.
 *
 * Everywhere except production, where the answer is no unless somebody opted in
 * by name for the end-to-end suite. One definition, so the registry, the stays
 * registry and the data-source switch cannot disagree about what "production"
 * means.
 */
export function mockAllowed(env: Pick<Env, 'NODE_ENV' | 'ALLOW_MOCK_IN_PRODUCTION'>): boolean {
  return env.NODE_ENV !== 'production' || env.ALLOW_MOCK_IN_PRODUCTION === true;
}
