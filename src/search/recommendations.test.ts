import { describe, expect, it, vi } from 'vitest';
import { createMemoryRepositories } from '@/db/memory';
import { AppError } from '@/lib/errors';
import { err, ok } from '@/lib/result';
import type { McpClient } from '@/providers/mcp/client';
import {
  createDailyCallBudget,
  RecommendationService,
  type RecommendationRequest,
} from './recommendations';

const HOUR = 3_600_000;
const clock = Date.parse('2027-01-10T12:00:00.000Z');
const now = () => clock;

const REQUEST: RecommendationRequest = {
  origin: 'VIE',
  from: '2027-02-01',
  to: '2027-02-28',
  minNights: 3,
  maxNights: 5,
  adults: 2,
  currency: 'EUR',
};

function itinerary(id: string, to: string, price: number) {
  const leg = (from: string, dest: string, day: string) => ({
    from,
    to: dest,
    durationSeconds: 7200,
    segments: [
      {
        from,
        to: dest,
        departureTime: `${day}T08:00:00`,
        arrivalTime: `${day}T10:00:00`,
        durationSeconds: 7200,
        carrier: 'FR',
        flightNumber: 'FR100',
      },
    ],
  });
  return {
    id,
    price,
    bookingUrl: `https://kiwi.com/u/${id}`,
    outbound: leg('VIE', to, '2027-02-09'),
    inbound: leg(to, 'VIE', '2027-02-13'),
  };
}

const ANSWER = JSON.stringify({
  currency: 'EUR',
  itineraries: [itinerary('a', 'LIS', 120.5), itinerary('b', 'LIS', 99), itinerary('c', 'BCN', 80)],
});

function fakeClient(answer: () => ReturnType<McpClient['callTool']>) {
  const callTool = vi.fn(answer);
  return { client: { callTool, close: async () => undefined } as McpClient, callTool };
}

const okAnswer = () => Promise.resolve(ok({ text: ANSWER }));
const failedAnswer = () => Promise.resolve(err(new AppError('PROVIDER_TIMEOUT', 'timed out')));

function setup(answer: () => ReturnType<McpClient['callTool']>, budget = 10) {
  const repos = createMemoryRepositories();
  const { client, callTool } = fakeClient(answer);
  const service = new RecommendationService({
    client,
    lists: repos.recommendationLists,
    offers: repos.kiwiOffers,
    routeGraph: repos.routeGraph,
    budget: createDailyCallBudget(budget, now),
    now,
  });
  return { repos, service, callTool };
}

async function seed(repos: ReturnType<typeof createMemoryRepositories>, ageMs: number) {
  await repos.recommendationLists.put({
    origin: 'VIE',
    window: '2027-02-01..2027-02-28',
    adults: 2,
    currency: 'EUR',
    items: [
      {
        destination: 'OLD',
        priceMinor: 5000,
        currency: 'EUR',
        departureDate: '2027-02-09',
        returnDate: '2027-02-13',
        carrier: null,
        deepLink: null,
      },
    ],
    generatedAt: new Date(clock - ageMs).toISOString(),
  });
}

describe('lazy recommendations', () => {
  it('serves a list younger than 12 hours and makes no MCP call', async () => {
    const { repos, service, callTool } = setup(() => {
      throw new Error('the MCP must not be called for a fresh list');
    });
    await seed(repos, 11 * HOUR);

    const view = await service.ensure(REQUEST);

    expect(callTool).not.toHaveBeenCalled();
    expect(view.status).toBe('fresh');
    expect(view.items.map((item) => item.destination)).toEqual(['OLD']);
    expect(view.refreshed).toBe(false);
  });

  it('peek never calls the MCP, however old the list is', async () => {
    const { repos, service, callTool } = setup(okAnswer);
    await seed(repos, 30 * HOUR);

    const view = await service.peek(REQUEST);

    expect(callTool).not.toHaveBeenCalled();
    expect(view.status).toBe('stale');
    expect(view.label).toBe('checked 30 h ago');
  });

  it('generates once when the stored list is stale, and stores the result', async () => {
    const { repos, service, callTool } = setup(okAnswer);
    await seed(repos, 13 * HOUR);

    const view = await service.ensure(REQUEST);

    expect(callTool).toHaveBeenCalledTimes(1);
    expect(
      (callTool.mock.calls[0] as unknown as [string, Record<string, unknown>])[1],
    ).toMatchObject({ flyTo: 'anywhere', one_for_city: true });
    expect(view.refreshed).toBe(true);
    expect(view.status).toBe('fresh');
    // Cheapest per destination, cheapest first, integer minor units.
    expect(view.items.map((i) => [i.destination, i.priceMinor])).toEqual([
      ['BCN', 8000],
      ['LIS', 9900],
    ]);
    const stored = await repos.recommendationLists.get({
      origin: 'VIE',
      window: '2027-02-01..2027-02-28',
      adults: 2,
      currency: 'EUR',
    });
    expect(stored?.items).toHaveLength(2);
    expect((await repos.routeGraph.destinationsFor('VIE')).map((e) => e.destination)).toEqual([
      'BCN',
      'LIS',
    ]);
  });

  it('generates once when there is no list at all', async () => {
    const { service, callTool } = setup(okAnswer);

    const view = await service.ensure(REQUEST);

    expect(callTool).toHaveBeenCalledTimes(1);
    expect(view.status).toBe('fresh');
    expect(view.items.length).toBeGreaterThan(0);
  });

  it('a failed generation keeps the stale list and labels its age', async () => {
    const { repos, service, callTool } = setup(failedAnswer);
    await seed(repos, 14 * HOUR);

    const view = await service.ensure(REQUEST);

    expect(callTool).toHaveBeenCalledTimes(1);
    expect(view.status).toBe('stale');
    expect(view.label).toBe('checked 14 h ago');
    expect(view.items.map((i) => i.destination)).toEqual(['OLD']);
    expect(view.refreshFailed).toBe('error');
  });

  it('a failed generation with nothing stored says there is no data, not an empty success', async () => {
    const { service } = setup(failedAnswer);
    const view = await service.ensure(REQUEST);
    expect(view.status).toBe('missing');
    expect(view.label).toBe('no data yet');
  });

  it('an exhausted call budget makes no further call and keeps the stale list', async () => {
    const { repos, service, callTool } = setup(okAnswer, 1);
    await seed(repos, 20 * HOUR);

    await service.ensure(REQUEST); // spends the one call and refreshes
    expect(callTool).toHaveBeenCalledTimes(1);

    // The list is now fresh, so make it stale again: the budget, not freshness, must stop the call.
    await seed(repos, 20 * HOUR);
    const view = await service.ensure(REQUEST);

    expect(callTool).toHaveBeenCalledTimes(1);
    expect(view.status).toBe('stale');
    expect(view.refreshFailed).toBe('budget');
    expect(view.items.map((i) => i.destination)).toEqual(['OLD']);
  });

  it('a daily budget allows its limit and then refuses, and resets the next UTC day', () => {
    let t = Date.parse('2027-01-10T12:00:00.000Z');
    const budget = createDailyCallBudget(2, () => t);
    expect([budget.tryTake(), budget.tryTake(), budget.tryTake()]).toEqual([true, true, false]);
    t = Date.parse('2027-01-11T00:00:01.000Z');
    expect(budget.tryTake()).toBe(true);
  });

  it('two simultaneous requests share one generation', async () => {
    const { service, callTool } = setup(okAnswer);
    await Promise.all([service.ensure(REQUEST), service.ensure(REQUEST)]);
    expect(callTool).toHaveBeenCalledTimes(1);
  });
});
