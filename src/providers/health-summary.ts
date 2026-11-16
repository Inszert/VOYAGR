import type { ProviderMode } from '@/core/trip/provenance';
import type { ProviderHealthStatus, ProviderKind } from './types';

/**
 * What a set of provider probes says about the deployment.
 *
 * An `absent` slot is configuration, not an outage: production deliberately has
 * no hotel, transfer or stay source yet, and the cost engine already reports
 * those lines as `excluded`. Counting such a slot as unavailable made
 * `/api/health` answer 503 on every healthy production deployment, which is a
 * health check that cannot be trusted either way. Only a slot that is meant to
 * be answering and is not degrades the status.
 */

export interface ProbedProvider {
  readonly kind: ProviderKind;
  readonly mode?: ProviderMode;
  readonly status: ProviderHealthStatus;
}

export type ReportedProviderStatus = ProviderHealthStatus | 'absent';

export function reportedStatus(
  provider: Pick<ProbedProvider, 'mode' | 'status'>,
): ReportedProviderStatus {
  return provider.mode === 'absent' ? 'absent' : provider.status;
}

export interface ProviderHealthSummary {
  /** Every configured provider answered healthy. */
  readonly healthy: boolean;
  /** Slots with no data source, listed so they are visible rather than silent. */
  readonly absent: readonly ProviderKind[];
  /** Configured providers that are not healthy. */
  readonly failing: readonly ProviderKind[];
}

export function summariseProviderHealth(
  providers: readonly ProbedProvider[],
): ProviderHealthSummary {
  const absent = providers.filter((p) => reportedStatus(p) === 'absent').map((p) => p.kind);
  const failing = providers
    .filter((p) => reportedStatus(p) !== 'absent' && p.status !== 'healthy')
    .map((p) => p.kind);

  return { healthy: failing.length === 0, absent, failing };
}
