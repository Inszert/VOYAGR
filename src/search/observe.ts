import { getRepositories } from '@/db';
import type { Repositories } from '@/db/repository';
import { getLogger } from '@/lib/logger';
import type { ProviderCallObservation } from './orchestrator';

const log = getLogger('search.observe');

/**
 * An observer that writes each provider call to `provider_requests`.
 *
 * Fire and forget: a search does not wait on its own metrics, and a store
 * that is down costs a log line, never a search.
 */
export function recordProviderCalls(
  repositories: Pick<Repositories, 'providerRequests'> = getRepositories(),
): (call: ProviderCallObservation) => void {
  return (call) => {
    repositories.providerRequests.record(call).catch((error: unknown) => {
      log.warn({ err: error, providerId: call.providerId }, 'could not record a provider call');
    });
  };
}
