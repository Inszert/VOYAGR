import { beforeEach, describe, expect, it, vi } from 'vitest';
import { money } from '@/core/money';
import { buildProfile } from '@/core/trip/test-support';
import { createMemoryRepositories } from '@/db/memory';
import { buildRankedTrip } from '@/components/search/test-support';
import type { Repositories } from '@/db/repository';
import type { SearchOutcome } from '@/search/types';
import { refreshWatch } from './refresh';

/**
 * Refreshing a watch.
 *
 * The property worth defending above all others: a refresh always reschedules.
 * A watch that fails to reschedule has silently stopped, and nothing in the
 * product would announce it.
 */

let repositories: Repositories;
let clock: number;

const MINUTE = 60_000;

beforeEach(async () => {
  repositories = createMemoryRepositories();
  clock = Date.parse('2026-09-19T12:00:00.000Z');
  await repositories.users.create({ id: 'user-1', email: 'a@example.invalid', plan: 'free' });
});

async function aWatch(overrides: Record<string, unknown> = {}) {
  const search = await repositories.tripSearches.create({
    id: 'search-1',
    userId: 'user-1',
    name: 'Watched',
    profile: buildProfile(),
    destinations: ['AYT'],
  });

  return repositories.travelWatches.create({
    id: 'watch-1',
    userId: 'user-1',
    tripSearchId: search.id,
    status: 'active',
    priority: 'normal',
    lastRunAt: null,
    nextRunAt: new Date(clock - MINUTE).toISOString(),
    bestKnownTotal: null,
    ...overrides,
  });
}

/** A search that returns one trip at the given total. */
function searchReturning(totalMinorUnits: number, currency = 'EUR') {
  const trip = buildRankedTrip();
  const outcome = {
    results: [{ ...trip, cost: { ...trip.cost, total: money(totalMinorUnits, currency) } }],
    nearMisses: [],
    diagnostics: { degraded: false },
  } as unknown as SearchOutcome;

  return vi.fn(async () => outcome);
}

describe('refreshWatch', () => {
  it('records the run and schedules the next one', async () => {
    const watch = await aWatch();

    await refreshWatch(watch.id, {
      repositories,
      now: () => clock,
      search: searchReturning(68000),
    });

    const after = await repositories.travelWatches.findById(watch.id);

    expect(after?.lastRunAt).toBe(new Date(clock).toISOString());
    expect(Date.parse(after!.nextRunAt)).toBeGreaterThan(clock);
  });

  it('reschedules even when the search throws', async () => {
    // The case that matters. A watch that stops rescheduling has stopped, and
    // nothing in the product would say so.
    const watch = await aWatch();

    const result = await refreshWatch(watch.id, {
      repositories,
      now: () => clock,
      search: vi.fn(async () => {
        throw new Error('every provider is down');
      }),
    });

    const after = await repositories.travelWatches.findById(watch.id);

    expect(result.ran).toBe(false);
    expect(Date.parse(after!.nextRunAt)).toBeGreaterThan(clock);
    expect(after?.lastRunAt).toBe(new Date(clock).toISOString());
  });

  it('remembers the cheapest eligible total it has seen', async () => {
    const watch = await aWatch();

    await refreshWatch(watch.id, {
      repositories,
      now: () => clock,
      search: searchReturning(68000),
    });
    expect((await repositories.travelWatches.findById(watch.id))?.bestKnownTotal).toEqual(
      money(68000, 'EUR'),
    );

    clock += 6 * 60 * MINUTE;
    const better = await refreshWatch(watch.id, {
      repositories,
      now: () => clock,
      search: searchReturning(61000),
    });

    expect(better.improvedBest).toBe(true);
    expect((await repositories.travelWatches.findById(watch.id))?.bestKnownTotal).toEqual(
      money(61000, 'EUR'),
    );
  });

  it('does not treat a more expensive result as an improvement', async () => {
    const watch = await aWatch();

    await refreshWatch(watch.id, {
      repositories,
      now: () => clock,
      search: searchReturning(61000),
    });

    clock += 6 * 60 * MINUTE;
    const result = await refreshWatch(watch.id, {
      repositories,
      now: () => clock,
      search: searchReturning(72000),
    });

    expect(result.improvedBest).toBe(false);
    // The cheaper observation is still on record, so it is still the best.
    expect((await repositories.travelWatches.findById(watch.id))?.bestKnownTotal).toEqual(
      money(61000, 'EUR'),
    );
  });

  it('re-derives the best total from history rather than trusting a cached one', async () => {
    // `bestKnownTotal` is a cache of "the cheapest we have ever recorded". A
    // value with no observation behind it cannot be substantiated, so the first
    // run that records anything replaces it. Deliberate: one source of truth
    // and one value derived from it beats two numbers meant to agree.
    const watch = await aWatch({ bestKnownTotal: money(61000, 'EUR') });

    await refreshWatch(watch.id, {
      repositories,
      now: () => clock,
      search: searchReturning(72000),
    });

    expect((await repositories.travelWatches.findById(watch.id))?.bestKnownTotal).toEqual(
      money(72000, 'EUR'),
    );
  });

  it('does not call a currency change an improvement', async () => {
    // Comparing 61000 EUR against 55000 GBP is meaningless, not favourable.
    const watch = await aWatch({ bestKnownTotal: money(61000, 'EUR') });

    const result = await refreshWatch(watch.id, {
      repositories,
      now: () => clock,
      search: searchReturning(55000, 'GBP'),
    });

    expect(result.improvedBest).toBe(false);
  });

  it('skips a watch that was paused before it was picked up', async () => {
    const watch = await aWatch({ status: 'paused' });
    const search = searchReturning(68000);

    const result = await refreshWatch(watch.id, { repositories, now: () => clock, search });

    expect(result.ran).toBe(false);
    expect(search).not.toHaveBeenCalled();
    // Not rescheduled either: resuming is what schedules it again.
    expect((await repositories.travelWatches.findById(watch.id))?.lastRunAt).toBeNull();
  });

  it('skips a watch that no longer exists without throwing', async () => {
    const result = await refreshWatch('gone', { repositories, now: () => clock });
    expect(result.ran).toBe(false);
  });

  it('applies the owner plan cadence, resolved at run time', async () => {
    const watch = await aWatch();

    await refreshWatch(watch.id, {
      repositories,
      now: () => clock,
      search: searchReturning(68000),
    });

    const after = await repositories.travelWatches.findById(watch.id);
    // Free plan floor is 6 hours.
    expect(Date.parse(after!.nextRunAt) - clock).toBe(6 * 60 * MINUTE);
  });
});

describe('price history accumulates', () => {
  it('writes the total and every priced component on each run', async () => {
    const watch = await aWatch();

    await refreshWatch(watch.id, {
      repositories,
      now: () => clock,
      search: searchReturning(68000),
    });

    const history = await repositories.priceHistory.listForWatch(watch.id);

    expect(history).toHaveLength(4);
    expect(history.every((row) => row.providerId.length > 0)).toBe(true);
    expect(history.every((row) => row.observedAt === new Date(clock).toISOString())).toBe(true);
  });

  it('accumulates across runs, and the lowest total can be queried', async () => {
    // This is Phase 1.7's "done when", end to end.
    const watch = await aWatch();

    for (const [total, offsetHours] of [
      [72000, 0],
      [65000, 6],
      [69000, 12],
    ] as const) {
      clock = Date.parse('2026-09-19T12:00:00.000Z') + offsetHours * 60 * MINUTE;
      await repositories.travelWatches.update(watch.id, {
        nextRunAt: new Date(clock - MINUTE).toISOString(),
      });
      await refreshWatch(watch.id, {
        repositories,
        now: () => clock,
        search: searchReturning(total),
      });
    }

    const history = await repositories.priceHistory.listForWatch(watch.id);
    expect(history).toHaveLength(12);

    const lowest = await repositories.priceHistory.findLowest(watch.id, 'trip_total', 'EUR');
    expect(lowest?.amount).toEqual(money(65000, 'EUR'));
    // The watch's cached best agrees, because it is derived from this.
    expect((await repositories.travelWatches.findById(watch.id))?.bestKnownTotal).toEqual(
      money(65000, 'EUR'),
    );
  });

  it('records a run that found nothing without writing a price', async () => {
    // "No eligible trip today" is not an observation of a price, and inventing
    // one would put a number in the history that nobody was ever offered.
    const watch = await aWatch();
    const empty = { results: [], nearMisses: [], diagnostics: { degraded: false } };

    const result = await refreshWatch(watch.id, {
      repositories,
      now: () => clock,
      search: async () => empty as never,
    });

    expect(result.observations).toBe(0);
    expect(await repositories.priceHistory.listForWatch(watch.id)).toEqual([]);
    // But the watch still ran and still rescheduled.
    expect((await repositories.travelWatches.findById(watch.id))?.lastRunAt).toBe(
      new Date(clock).toISOString(),
    );
  });
});
