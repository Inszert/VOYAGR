import { NextResponse } from 'next/server';
import { checkDatabaseHealth } from '@/db';
import { getCapabilities } from '@/lib/env';
import { getLogger } from '@/lib/logger';
import { toLogPayload, toProblemDetails } from '@/lib/errors';
import { getProviderRegistry } from '@/providers/registry';

/**
 * Health endpoint.
 *
 * Reports what is configured and reachable, for CI, deployment checks and the
 * end-to-end smoke test.
 *
 * What it deliberately does not report: connection strings, key values, provider
 * credentials or environment variable contents. Capabilities are booleans. A
 * health endpoint that leaks configuration is a reconnaissance gift.
 */

const log = getLogger('api.health');

// Health must reflect live state, never a cached response.
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET() {
  const startedAt = Date.now();

  try {
    const registry = getProviderRegistry();
    const capabilities = getCapabilities();

    const [database, providers] = await Promise.all([checkDatabaseHealth(), registry.checkAll()]);

    const providersHealthy = Object.values(providers).every(
      (provider) => provider.status === 'healthy',
    );

    // Unconfigured optional dependencies are expected in the foundation and do
    // not make the service unhealthy. Only a configured-but-unreachable database
    // degrades it.
    const databaseDegraded = database.configured && !database.reachable;
    const status = databaseDegraded || !providersHealthy ? 'degraded' : 'ok';

    return NextResponse.json(
      {
        status,
        service: 'voyagr',
        checkedAt: new Date().toISOString(),
        durationMs: Date.now() - startedAt,
        capabilities: {
          database: capabilities.database,
          redis: capabilities.redis,
          backgroundJobs: capabilities.bullmq ? 'bullmq' : 'in-process',
          webPush: capabilities.webPush,
          ai: capabilities.liveAi ? 'live' : 'mock',
          providersFullyMocked: registry.isFullyMocked(),
        },
        database: {
          configured: database.configured,
          reachable: database.reachable,
        },
        providers: Object.fromEntries(
          Object.entries(providers).map(([kind, health]) => [
            kind,
            { id: health.id, status: health.status },
          ]),
        ),
      },
      {
        status: status === 'ok' ? 200 : 503,
        headers: { 'Cache-Control': 'no-store' },
      },
    );
  } catch (error) {
    log.error(toLogPayload(error), 'health check failed');

    return NextResponse.json(toProblemDetails(error), {
      status: 500,
      headers: { 'Cache-Control': 'no-store' },
    });
  }
}
