// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RouteGraphRepository } from '@/db/repository';

/**
 * The lazy globe's rule: moving the globe never costs a provider call.
 * The spies stand where the flight provider and the MCP client would be reached from; any
 * call to them while the globe's data path runs fails the test.
 */
const providerSpy = vi.fn();
const mcpSpy = vi.fn();

vi.mock('@/providers/registry', () => ({
  getProviderRegistry: (...args: unknown[]) => providerSpy(...args),
}));
vi.mock('@/providers/mcp/client', () => ({
  createMcpClient: (...args: unknown[]) => mcpSpy(...args),
}));
vi.mock('@/providers/flights/kiwi-mcp', () => ({
  createKiwiMcpFlightProvider: (...args: unknown[]) => mcpSpy(...args),
}));

const edge = (origin: string, destination: string, carrier = 'FR') => ({
  origin,
  destination,
  carrier,
  firstSeenAt: '2026-11-01T00:00:00.000Z',
  lastSeenAt: '2026-11-20T00:00:00.000Z',
});

const graph: RouteGraphRepository = {
  upsertEdges: async () => undefined,
  destinationsFor: async (origin) =>
    origin === 'VIE'
      ? [edge('VIE', 'BCN'), edge('VIE', 'BCN', 'VY'), edge('VIE', 'JFK', 'OS'), edge('VIE', 'ZZZ')]
      : [],
};

vi.mock('@/db', () => ({ getRepositories: () => ({ routeGraph: graph }) }));

beforeEach(() => {
  providerSpy.mockClear();
  mcpSpy.mockClear();
});

async function get(query: string) {
  const { GET } = await import('./route');
  return GET(new Request(`http://localhost/api/globe-routes?${query}`));
}

describe('GET /api/globe-routes', () => {
  it('never reaches the flight provider or the MCP client, however often the globe moves', async () => {
    for (let i = 0; i < 20; i += 1) {
      const west = -180 + i;
      await get(`origin=VIE&west=${west}&south=-60&east=${west + 90}&north=70`);
    }
    expect(providerSpy).not.toHaveBeenCalled();
    expect(mcpSpy).not.toHaveBeenCalled();
  });

  it('returns only stored routes that are placed and visible', async () => {
    const response = await get('origin=VIE&west=-30&south=20&east=40&north=70');
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      routes: { destination: string; carriers: string[] }[];
    };
    // JFK is outside the box; ZZZ has no known position; BCN has two stored carriers.
    expect(body.routes.map((r) => r.destination)).toEqual(['BCN']);
    expect(body.routes[0]?.carriers).toEqual(['FR', 'VY']);
  });

  it('returns nothing for an origin with no stored routes, and says so honestly', async () => {
    const response = await get('origin=LHR&west=-180&south=-90&east=180&north=90');
    const body = (await response.json()) as { routes: unknown[] };
    expect(body.routes).toEqual([]);
  });

  it('refuses a malformed request', async () => {
    expect((await get('origin=nope')).status).toBe(400);
  });
});
