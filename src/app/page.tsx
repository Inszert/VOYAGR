import type { Metadata } from 'next';
import { Badge, Card, CardDescription, CardHeader, CardTitle } from '@/components/ui';
import { getProviderRegistry } from '@/providers/registry';
import { getCapabilities } from '@/lib/env';

/**
 * Foundation status page.
 *
 * Deliberately not a product screen. It reports what the engineering foundation
 * has wired up and which capabilities configuration currently enables, which is
 * genuinely useful while building and honest about the fact that no travel
 * search exists yet.
 *
 * The Phase 1 search UI replaces this page.
 */

export const metadata: Metadata = {
  title: 'Foundation status',
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

export default function HomePage() {
  const registry = getProviderRegistry();
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
        <h1 className="text-ink text-3xl font-semibold tracking-tight">
          Voyagr engineering foundation
        </h1>
        <p className="text-ink-muted max-w-2xl text-base">
          The scaffolding is in place: a deterministic trip core, provider adapters behind
          interfaces, an AI abstraction with guardrails, and testing, security and CI baselines. No
          product features are implemented yet.
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

      <section aria-labelledby="next-heading" className="flex flex-col gap-3">
        <h2 id="next-heading" className="text-ink text-xl font-semibold">
          What comes next
        </h2>
        <p className="text-ink-muted max-w-2xl text-base">
          Phase 1 builds the loop the product is judged on: a search becomes a saved Travel Watch,
          workers keep refreshing it, and a materially better trip produces an alert. The plan is in{' '}
          <code className="bg-surface-sunken rounded px-1.5 py-0.5 font-mono text-sm">
            docs/implementation-plan.md
          </code>
          .
        </p>
      </section>
    </div>
  );
}
