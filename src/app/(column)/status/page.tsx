import type { Metadata } from 'next';
import { Badge, Card, CardDescription, CardHeader, CardTitle } from '@/components/ui';
import { getProviderRegistry } from '@/providers/registry';
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
          Mock
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

  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-3">
        <h1 className="font-display text-display-md text-ink">System status</h1>
        <p className="text-ink-muted max-w-2xl text-base">
          What this deployment is running on, and how each travel data provider has behaved over the
          last day.
        </p>
      </section>

      <section aria-labelledby="subsystems-heading" className="flex flex-col gap-4">
        <h2 id="subsystems-heading" className="text-ink text-xl font-semibold">
          Subsystems
        </h2>

        <ul className="grid gap-4 sm:grid-cols-2">
          {subsystems.map((subsystem) => (
            <li key={subsystem.name}>
              <Card as="article" className="h-full">
                <CardHeader>
                  <div className="flex items-start justify-between gap-3">
                    <CardTitle level={3}>{subsystem.name}</CardTitle>
                    {stateBadge(subsystem.state)}
                  </div>
                  <CardDescription>{subsystem.detail}</CardDescription>
                </CardHeader>
              </Card>
            </li>
          ))}
        </ul>
      </section>

      {/*
        Per-provider figures, so a degraded search can be told from a broken
        vendor without reading logs. Every call a search or a watch makes is
        recorded with how it ended and how long it took.
      */}
      <section aria-labelledby="providers-heading" className="flex flex-col gap-4">
        <h2 id="providers-heading" className="text-ink text-xl font-semibold">
          Providers, last 24 hours
        </h2>

        {providerCalls === null ? (
          <p className="text-ink-muted text-sm">Provider figures could not be read just now.</p>
        ) : providerCalls.length === 0 ? (
          <p className="text-ink-muted text-sm">No provider calls in the last 24 hours.</p>
        ) : (
          <div className="border-border overflow-x-auto rounded-(--radius-card) border">
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
