import type { ProviderCallSummary, ProviderRequestRecord } from '@/db/repository';

/**
 * Per-provider call figures, from the calls themselves.
 *
 * Pure. The in-memory repository summarises with this; the Postgres one
 * computes the same thing in SQL, and the shared contract suite holds the two
 * to the same answer. Nearest-rank percentiles: the smallest duration that at
 * least that share of calls came in at or under - the method Postgres's
 * `percentile_disc` uses, so both backends agree to the millisecond.
 */

/** Nearest-rank percentile of an ascending list. */
export function nearestRank(sorted: readonly number[], share: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.max(0, Math.ceil(share * sorted.length) - 1);
  return sorted[Math.min(index, sorted.length - 1)]!;
}

export function summariseProviderCalls(
  records: readonly Pick<ProviderRequestRecord, 'providerId' | 'kind' | 'status' | 'durationMs'>[],
): ProviderCallSummary[] {
  const groups = new Map<string, typeof records>();

  for (const record of records) {
    const key = `${record.providerId}\u0000${record.kind}`;
    groups.set(key, [...(groups.get(key) ?? []), record]);
  }

  return [...groups.values()]
    .map((calls) => {
      const durations = calls.map((call) => call.durationMs).sort((a, b) => a - b);
      return {
        providerId: calls[0]!.providerId,
        kind: calls[0]!.kind,
        calls: calls.length,
        errors: calls.filter((call) => call.status === 'error').length,
        timeouts: calls.filter((call) => call.status === 'timeout').length,
        rateLimited: calls.filter((call) => call.status === 'rate_limited').length,
        p50Ms: nearestRank(durations, 0.5),
        p95Ms: nearestRank(durations, 0.95),
      };
    })
    .sort((a, b) => b.calls - a.calls || a.providerId.localeCompare(b.providerId));
}
