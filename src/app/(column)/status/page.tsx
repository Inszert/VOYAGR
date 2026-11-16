import type { Metadata } from 'next';
import { Badge, PageHeader, describeAge } from '@/components/ui';
import { getCacheStore } from '@/cache';
import { buildCacheTargets } from '@/cache/targets';
import {
  DISCOVERY_STALE_MS,
  DISCOVERY_TTL_MS,
  buildDiscoveryRequest,
  discoveryCacheKey,
} from '@/discovery/snapshot';
import { getProviderRegistry } from '@/providers/registry';
import { getStayProviders } from '@/providers/stays/registry';
import { getActiveDataSource } from '@/providers/request-source';
import type { ProviderMode } from '@/core/trip/provenance';
import { getCapabilities } from '@/lib/env';
import { getRepositories } from '@/db';

/**
 * Foundation status page.
 *
 * Deliberately not a product screen. It reports what the engineering foundation
 * has wired up and which capabilities configuration currently enables, which is
 * genuinely useful while building and honest about how much of the product is
 * still mocked.
 *
 * It lived at `/` until the Phase 1.2 search UI took that route. Kept because
 * "which providers are real today?" is a question worth being able to answer
 * without reading configuration.
 */

export const metadata: Metadata = {
  title: 'System status',
};

interface Subsystem {
  readonly name: string;
  readonly detail: string;
  readonly state: 'ready' | 'mocked' | 'pending';
}

function stateBadge(state: Subsystem['state']) {
  switch (state) {
    case 'ready':
      return (
        <Badge tone="positive" srPrefix="Status">
          Ready
        </Badge>
      );
    case 'mocked':
      return (
        <Badge tone="caution" srPrefix="Status">
          Fixture
        </Badge>
      );
    case 'pending':
      return (
        <Badge tone="neutral" srPrefix="Status">
          Not configured
        </Badge>
      );
  }
}

/** The last day of provider calls, or null when the store cannot be read. */
async function lastDayOfProviderCalls() {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  return getRepositories()
    .providerRequests.summarise(since)
    .catch(() => null);
}

interface Slot {
  readonly slot: string;
  readonly provider: string;
  readonly state: 'live' | 'absent' | 'fixture';
  readonly detail: string;
}

const MODE_WORDS: Record<ProviderMode, { state: Slot['state']; detail: string }> = {
  live: { state: 'live', detail: 'Answering with real data.' },
  indicative: { state: 'live', detail: 'Real fares from a cache, which may have moved.' },
  test: { state: 'live', detail: 'A sandbox account: real shapes, not bookable.' },
  mock: { state: 'fixture', detail: 'Sample data from fixtures, not real offers.' },
  absent: {
    state: 'absent',
    detail: 'No provider is connected, so nothing is shown. This is configuration, not an outage.',
  },
};

function slotOf(
  slot: string,
  metadata: { displayName: string; isMock: boolean; mode?: ProviderMode },
): Slot {
  const mode: ProviderMode = metadata.mode ?? (metadata.isMock ? 'mock' : 'live');
  return { slot, provider: metadata.displayName, ...MODE_WORDS[mode] };
}

const SLOT_BADGE = {
  live: { tone: 'positive', word: 'Live' },
  absent: { tone: 'neutral', word: 'Absent' },
  fixture: { tone: 'caution', word: 'Fixture' },
} as const;

/**
 * How warm the discovery cache is: the newest entry the worker or a visitor
 * wrote, out of the targets the worker keeps warm. Read from the store, not
 * estimated; null when it cannot be read.
 */
async function cacheFreshness() {
  try {
    const store = getCacheStore();
    const { effective } = await getActiveDataSource();
    const today = new Date().toISOString().slice(0, 10);
    const targets = buildCacheTargets();

    const entries = await Promise.all(
      targets.map(async (target) => {
        const request = buildDiscoveryRequest(target.input(today));
        return request ? store.get(discoveryCacheKey(request, effective)) : null;
      }),
    );

    const stamps = entries
      .flatMap((entry) => (entry ? [Date.parse(entry.observedAt)] : []))
      .filter((stamp) => Number.isFinite(stamp));

    return {
      backend: store.name,
      warm: stamps.length,
      total: targets.length,
      newestAgeMs: stamps.length > 0 ? Date.now() - Math.max(...stamps) : null,
    };
  } catch {
    return null;
  }
}

function hours(ms: number): string {
  const value = Math.round(ms / 3_600_000);
  return value === 1 ? '1 hour' : `${value} hours`;
}

export default async function StatusPage() {
  const registry = getProviderRegistry();

  // The last day of provider calls, summarised by the repository. Every
  // figure is a count or a measured duration; nothing here is estimated.
  const providerCalls = await lastDayOfProviderCalls();
  const capabilities = getCapabilities();

  const subsystems: Subsystem[] = [
    {
      name: 'Deterministic core',
      detail: 'Money, true trip cost, hard constraints, usable time and scoring.',
      state: 'ready',
    },
    {
      name: 'Provider adapters',
      detail: `Flights, hotels, weather, transfers and places behind interfaces. Active: ${registry.flights.metadata.displayName}.`,
      state: registry.isFullyMocked() ? 'mocked' : 'ready',
    },
    {
      name: 'AI abstraction',
      detail: 'Model reasons and explains; it never produces a price or a total.',
      state: capabilities.liveAi ? 'ready' : 'mocked',
    },
    {
      name: 'Persistence',
      detail: capabilities.database
        ? 'PostgreSQL configured.'
        : 'In-memory repositories; no database required yet.',
      state: capabilities.database ? 'ready' : 'mocked',
    },
    {
      name: 'Background jobs',
      detail: capabilities.bullmq
        ? 'BullMQ on Redis.'
        : 'In-process queue driver; no Redis required yet.',
      state: capabilities.bullmq ? 'ready' : 'mocked',
    },
    {
      name: 'Web Push',
      detail: capabilities.webPush
        ? 'VAPID keys configured.'
        : 'Service worker registered; VAPID keys not set.',
      state: capabilities.webPush ? 'ready' : 'pending',
    },
  ];

  const dataSource = await getActiveDataSource();
  const cache = await cacheFreshness();

  const slots: Slot[] = [
    slotOf('Flights', registry.flights.metadata),
    slotOf('Hotels', registry.hotels.metadata),
    ...getStayProviders(undefined, dataSource.effective).map((provider) =>
      slotOf('Stays', provider.metadata),
    ),
    slotOf('Weather', registry.weather.metadata),
    slotOf('Transfers', registry.transfers.metadata),
    slotOf('Places', registry.places.metadata),
  ];

  return (
    <div className="flex flex-col gap-12">
      <PageHeader
        eyebrow="System"
        title="Status"
        description="What this deployment is connected to, how warm its cache is, and how each provider has behaved over the last day."
      />

      <section aria-labelledby="slots-heading" className="flex max-w-4xl flex-col gap-4">
        <h2 id="slots-heading" className="font-display text-display-sm text-ink">
          Provider slots
        </h2>

        <div
          // A region that scrolls sideways has to be reachable by keyboard, or its far columns
          // are not available to anyone who is not using a pointer.
          tabIndex={0}
          role="region"
          aria-label="Provider slots, scrollable"
          className="border-border overflow-x-auto rounded-(--radius-card) border"
        >
          <table className="w-full text-sm">
            <thead className="bg-surface-sunken text-ink-muted text-left">
              <tr>
                <th scope="col" className="px-4 py-3 font-medium">
                  Slot
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  Provider
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  State
                </th>
                <th scope="col" className="hidden px-4 py-3 font-medium md:table-cell">
                  What that means
                </th>
              </tr>
            </thead>
            <tbody className="divide-border divide-y">
              {slots.map((slot) => (
                <tr key={`${slot.slot}-${slot.provider}`}>
                  <th scope="row" className="text-ink px-4 py-3 text-left font-medium">
                    {slot.slot}
                  </th>
                  <td className="text-ink px-4 py-3">{slot.provider}</td>
                  <td className="px-4 py-3">
                    <Badge tone={SLOT_BADGE[slot.state].tone}>{SLOT_BADGE[slot.state].word}</Badge>
                  </td>
                  <td className="text-ink-muted hidden px-4 py-3 md:table-cell">{slot.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section aria-labelledby="cache-heading" className="flex max-w-4xl flex-col gap-4">
        <h2 id="cache-heading" className="font-display text-display-sm text-ink">
          Cache
        </h2>

        {cache === null ? (
          <p className="text-ink-muted text-sm">The cache could not be read just now.</p>
        ) : (
          <dl className="border-border divide-border grid divide-y rounded-(--radius-card) border text-sm sm:grid-cols-3 sm:divide-x sm:divide-y-0">
            <div className="flex flex-col gap-1 p-4">
              <dt className="text-dim">Last refresh</dt>
              <dd className="text-ink text-base font-medium tabular-nums">
                {cache.newestAgeMs === null
                  ? 'Nothing cached yet'
                  : describeAge(cache.newestAgeMs).replace(/^Updated /, '')}
              </dd>
            </div>
            <div className="flex flex-col gap-1 p-4">
              <dt className="text-dim">Warm targets</dt>
              <dd className="text-ink text-base font-medium tabular-nums">
                {cache.warm} of {cache.total}
              </dd>
            </div>
            <div className="flex flex-col gap-1 p-4">
              <dt className="text-dim">Held in</dt>
              <dd className="text-ink text-base font-medium">
                {cache.backend === 'redis' ? 'Redis' : 'Memory, lost on restart'}
              </dd>
            </div>
          </dl>
        )}

        <p className="text-ink-muted max-w-[60ch] text-sm leading-relaxed">
          A price is served as fresh for {hours(DISCOVERY_TTL_MS)} and as stale, and said to be, for
          up to {hours(DISCOVERY_STALE_MS)} after that while a refresh runs.
        </p>
      </section>

      <section aria-labelledby="subsystems-heading" className="flex max-w-4xl flex-col gap-4">
        <h2 id="subsystems-heading" className="font-display text-display-sm text-ink">
          Subsystems
        </h2>

        <div
          // A region that scrolls sideways has to be reachable by keyboard, or its far columns
          // are not available to anyone who is not using a pointer.
          tabIndex={0}
          role="region"
          aria-label="Subsystems, scrollable"
          className="border-border overflow-x-auto rounded-(--radius-card) border"
        >
          <table className="w-full text-sm">
            <thead className="bg-surface-sunken text-ink-muted text-left">
              <tr>
                <th scope="col" className="px-4 py-3 font-medium">
                  Subsystem
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  State
                </th>
                <th scope="col" className="hidden px-4 py-3 font-medium md:table-cell">
                  Detail
                </th>
              </tr>
            </thead>
            <tbody className="divide-border divide-y">
              {subsystems.map((subsystem) => (
                <tr key={subsystem.name}>
                  <th scope="row" className="text-ink px-4 py-3 text-left font-medium">
                    {subsystem.name}
                    <span className="text-ink-muted mt-1 block text-xs font-normal md:hidden">
                      {subsystem.detail}
                    </span>
                  </th>
                  <td className="px-4 py-3 align-top">{stateBadge(subsystem.state)}</td>
                  <td className="text-ink-muted hidden px-4 py-3 md:table-cell">
                    {subsystem.detail}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/*
        Per-provider figures, so a degraded search can be told from a broken
        vendor without reading logs. Every call a search or a watch makes is
        recorded with how it ended and how long it took.
      */}
      <section aria-labelledby="providers-heading" className="flex max-w-4xl flex-col gap-4">
        <h2 id="providers-heading" className="font-display text-display-sm text-ink">
          Providers, last 24 hours
        </h2>

        {providerCalls === null ? (
          <p className="text-ink-muted text-sm">Provider figures could not be read just now.</p>
        ) : providerCalls.length === 0 ? (
          <p className="text-ink-muted text-sm">No provider calls in the last 24 hours.</p>
        ) : (
          <div
            // A region that scrolls sideways has to be reachable by keyboard, or its far columns
            // are not available to anyone who is not using a pointer.
            tabIndex={0}
            role="region"
            aria-label="Provider calls, scrollable"
            className="border-border overflow-x-auto rounded-(--radius-card) border"
          >
            <table className="w-full text-sm tabular-nums">
              <thead className="bg-surface-sunken text-ink-muted text-left">
                <tr>
                  <th scope="col" className="px-3 py-2 font-medium">
                    Provider
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    Kind
                  </th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">
                    Calls
                  </th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">
                    Errors
                  </th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">
                    Timeouts
                  </th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">
                    Rate limited
                  </th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">
                    Median
                  </th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">
                    95th percentile
                  </th>
                </tr>
              </thead>
              <tbody className="divide-border divide-y">
                {providerCalls.map((row) => (
                  <tr key={`${row.providerId}-${row.kind}`}>
                    <th scope="row" className="text-ink px-3 py-2 text-left font-medium">
                      {row.providerId}
                    </th>
                    <td className="text-ink-muted px-3 py-2">{row.kind}</td>
                    <td className="text-ink px-3 py-2 text-right">{row.calls}</td>
                    <td
                      className={`px-3 py-2 text-right ${row.errors > 0 ? 'text-critical-ink' : 'text-ink-muted'}`}
                    >
                      {row.errors}
                    </td>
                    <td
                      className={`px-3 py-2 text-right ${row.timeouts > 0 ? 'text-caution-ink' : 'text-ink-muted'}`}
                    >
                      {row.timeouts}
                    </td>
                    <td
                      className={`px-3 py-2 text-right ${row.rateLimited > 0 ? 'text-caution-ink' : 'text-ink-muted'}`}
                    >
                      {row.rateLimited}
                    </td>
                    <td className="text-ink px-3 py-2 text-right">{row.p50Ms} ms</td>
                    <td className="text-ink px-3 py-2 text-right">{row.p95Ms} ms</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
