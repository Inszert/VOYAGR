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
    const watch = await aWatch({ bestKnownTotal: money(61000, 'EUR') });

    const result = await refreshWatch(watch.id, {
      repositories,
      now: () => clock,
      search: searchReturning(72000),
    });

    expect(result.improvedBest).toBe(false);
    expect((await repositories.travelWatches.findById(watch.id))?.bestKnownTotal).toEqual(
      money(61000, 'EUR'),
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
