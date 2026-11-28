// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { RecommendationListRow } from '@/db/repository';
import type { McpClient } from '@/providers/mcp/client';
import {
  lazyMcpClient,
  peekHomeRecommendations,
  refreshHomeRecommendations,
} from './recommendation-runtime';
import { RecommendationService } from './recommendations';

const request = {
  origin: 'VIE',
  from: '2027-02-01',
  to: '2027-03-01',
  minNights: 3,
  maxNights: 7,
  adults: 1,
  currency: 'EUR',
};
const NOW = Date.parse('2027-01-10T12:00:00.000Z');

async function serviceWith(generatedAt: string) {
  const callTool = vi.fn();
  const client: McpClient = { callTool, close: async () => undefined };
  const rows: RecommendationListRow[] = [];
  const lists = {
    get: async () => rows[0] ?? null,
    put: async (row: RecommendationListRow) => void (rows[0] = row),
  };
  await lists.put({
    origin: 'VIE',
    window: '2027-02-01..2027-03-01',
    adults: 1,
    currency: 'EUR',
    generatedAt,
    items: [
      {
        destination: 'BCN',
        priceMinor: 8000,
        currency: 'EUR',
        departureDate: '2027-02-09',
        returnDate: '2027-02-13',
        carrier: null,
        deepLink: null,
      },
    ],
  });
  const service = new RecommendationService({
    client,
    lists,
    offers: { get: vi.fn(), put: vi.fn() } as never,
    routeGraph: { upsertEdges: vi.fn(), destinationsFor: vi.fn() } as never,
    budget: { tryTake: () => true },
    now: () => NOW,
  });
  return { service, callTool };
}

describe('home recommendations', () => {
  it('a fresh list is served on render and on refresh with zero MCP calls', async () => {
    const { service, callTool } = await serviceWith('2027-01-10T08:00:00.000Z');
    const peeked = await peekHomeRecommendations(request, service);
    const ensured = await refreshHomeRecommendations(request, service);
    expect(peeked.status).toBe('fresh');
    expect(ensured.status).toBe('fresh');
    expect(callTool).not.toHaveBeenCalled();
  });

  it('a stale list is served by peek without a call; only the refresh builds', async () => {
    const { service, callTool } = await serviceWith('2027-01-09T08:00:00.000Z');
    callTool.mockResolvedValue({ ok: false, error: { code: 'x' } });
    const peeked = await peekHomeRecommendations(request, service);
    expect(peeked.status).toBe('stale');
    expect(callTool).not.toHaveBeenCalled();
    await refreshHomeRecommendations(request, service);
    expect(callTool).toHaveBeenCalledTimes(1);
  });

  it('the lazy client is not even constructed until a tool is called', async () => {
    const make = vi.fn(
      () => ({ callTool: vi.fn(async () => ({ ok: true })), close: vi.fn() }) as never,
    );
    const client = lazyMcpClient(make);
    expect(make).not.toHaveBeenCalled();
    await client.callTool('search-flight', {});
    expect(make).toHaveBeenCalledTimes(1);
  });
});

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) sourceFiles(path, out);
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(path);
  }
  return out;
}

describe('page render paths', () => {
  it('no page or page loader reaches the MCP client or the Kiwi provider directly', () => {
    const pages = sourceFiles('src/app').filter((f) => /[\\/]page\.tsx$/.test(f));
    const loaders = ['src/discovery/load-stage.ts', 'src/search/hub-saving.ts'];
    const forbidden = /providers\/mcp\/client|flights\/kiwi-mcp|createMcpClient|callTool\(/;
    const offenders = [...pages, ...loaders].filter((f) => forbidden.test(readFileSync(f, 'utf8')));
    expect(pages.length).toBeGreaterThan(5);
    expect(offenders).toEqual([]);
  });
});
