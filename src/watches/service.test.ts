import { beforeEach, describe, expect, it } from 'vitest';
import { money } from '@/core/money';
import { resolveEntitlements } from '@/core/entitlements';
import { buildProfile } from '@/core/trip/test-support';
import { createMemoryRepositories } from '@/db/memory';
import { AppError } from '@/lib/errors';
import type { Repositories } from '@/db/repository';
import type { AuthenticatedUser } from '@/auth/service';
import { WatchService } from './service';

/**
 * Saved searches and watches.
 *
 * The behaviour under test is mostly about limits: a plan says how many trips
 * may be watched at once, and every path that could spend a slot has to consult
 * it. A limit enforced on creation but not on resuming is not a limit.
 */

const free = resolveEntitlements('free');

let repositories: Repositories;
let watches: WatchService;
let clock: number;
let user: AuthenticatedUser;
let other: AuthenticatedUser;

function asUser(id: string, email: string): AuthenticatedUser {
  return { id, email, plan: 'free', entitlements: free };
}

beforeEach(async () => {
  repositories = createMemoryRepositories();
  clock = Date.parse('2026-09-19T12:00:00.000Z');
  watches = new WatchService({ repositories, now: () => clock });

  user = asUser('user-1', 'traveller@example.invalid');
  other = asUser('user-2', 'someone-else@example.invalid');

  await repositories.users.create({ id: user.id, email: user.email, plan: 'free' });
  await repositories.users.create({ id: other.id, email: other.email, plan: 'free' });
});

async function save(owner = user, name = 'June somewhere warm') {
  return watches.saveSearch(owner, {
    name,
    profile: buildProfile(),
    destinations: ['AYT', 'CHQ'],
  });
}

describe('saveSearch', () => {
  it('keeps the profile and the destinations together', async () => {
    const search = await save();

    expect(search.name).toBe('June somewhere warm');
    // Without the destinations the watch could not replay the search.
    expect(search.destinations).toEqual(['AYT', 'CHQ']);
    expect(search.profile.targetBudget).toEqual(buildProfile().targetBudget);
  });

  it('refuses a search with no name or no destination', async () => {
    await expect(
      watches.saveSearch(user, { name: '   ', profile: buildProfile(), destinations: ['AYT'] }),
    ).rejects.toThrow(AppError);

    await expect(
      watches.saveSearch(user, { name: 'Nowhere', profile: buildProfile(), destinations: [] }),
    ).rejects.toThrow(AppError);
  });

  it('enforces the plan allowance rather than a constant', async () => {
    for (let index = 0; index < free.maxSavedSearches; index += 1) {
      await save(user, `Search ${index}`);
    }

    const error = await save(user, 'One too many').catch((e: AppError) => e);

    expect((error as AppError).code).toBe('FORBIDDEN');
    expect((error as AppError).publicMessage).toContain(String(free.maxSavedSearches));
  });
});

describe('startWatching', () => {
  it('creates an active watch that is due straight away', async () => {
    // Someone who just asked to watch a trip expects the first check now.
    const search = await save();
    const watch = await watches.startWatching(user, search.id);

    expect(watch.status).toBe('active');
    expect(watch.tripSearchId).toBe(search.id);
    expect(Date.parse(watch.nextRunAt)).toBeLessThanOrEqual(clock);
    expect(watch.lastRunAt).toBeNull();
    expect(watch.bestKnownTotal).toBeNull();
  });

  it('is idempotent for a search already being watched', async () => {
    const search = await save();
    const first = await watches.startWatching(user, search.id);
    const second = await watches.startWatching(user, search.id);

    // Two watches on one search would double the provider calls and alert
    // the user twice about the same trip.
    expect(second.id).toBe(first.id);
    expect(await repositories.travelWatches.listByUser(user.id)).toHaveLength(1);
  });

  it('enforces the active-watch limit from the plan', async () => {
    for (let index = 0; index < free.maxActiveWatches; index += 1) {
      const search = await save(user, `Search ${index}`);
      await watches.startWatching(user, search.id);
    }

    const extra = await save(user, 'One too many');
    const error = await watches.startWatching(user, extra.id).catch((e: AppError) => e);

    expect((error as AppError).code).toBe('FORBIDDEN');
    expect((error as AppError).publicMessage).toContain(String(free.maxActiveWatches));
  });

  it('refuses to watch a search belonging to someone else', async () => {
    const theirs = await save(other);

    // Reported as "not found" rather than "not yours", which tells a prober
    // nothing about what exists.
    const error = await watches.startWatching(user, theirs.id).catch((e: AppError) => e);
    expect((error as AppError).code).toBe('NOT_FOUND');
  });

  it('quietly declines a priority the plan does not include', async () => {
    const search = await save();
    const watch = await watches.startWatching(user, search.id, 'high');

    expect(free.canPrioritiseWatches).toBe(false);
    expect(watch.priority).toBe('normal');
  });
});

describe('pausing, resuming and archiving', () => {
  it('frees a slot when paused and spends one when resumed', async () => {
    const searches = [];
    for (let index = 0; index < free.maxActiveWatches; index += 1) {
      const search = await save(user, `Search ${index}`);
      searches.push(await watches.startWatching(user, search.id));
    }

    await watches.setStatus(user, searches[0]!.id, 'paused');

    // The freed slot is usable.
    const extra = await save(user, 'Now there is room');
    await expect(watches.startWatching(user, extra.id)).resolves.toBeTruthy();

    // And resuming the paused one is refused, because the slot is taken again.
    const error = await watches.setStatus(user, searches[0]!.id, 'active').catch((e) => e);
    expect((error as AppError).code).toBe('FORBIDDEN');
  });

  it('checks a resumed watch promptly rather than after a stale interval', async () => {
    const search = await save();
    const watch = await watches.startWatching(user, search.id);

    await watches.setStatus(user, watch.id, 'paused');
    clock += 30 * 24 * 60 * 60 * 1000;
    const resumed = await watches.setStatus(user, watch.id, 'active');

    expect(Date.parse(resumed.nextRunAt)).toBe(clock);
  });

  it('never blocks pausing or archiving', async () => {
    const search = await save();
    const watch = await watches.startWatching(user, search.id);

    await expect(watches.setStatus(user, watch.id, 'paused')).resolves.toMatchObject({
      status: 'paused',
    });
    await expect(watches.setStatus(user, watch.id, 'archived')).resolves.toMatchObject({
      status: 'archived',
    });
  });

  it('refuses to touch someone else’s watch', async () => {
    const theirSearch = await save(other);
    const theirWatch = await watches.startWatching(other, theirSearch.id);

    await expect(watches.setStatus(user, theirWatch.id, 'archived')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(watches.setPriority(user, theirWatch.id, 'high')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});

describe('listForUser', () => {
  it('pairs each watch with the search it replays', async () => {
    const search = await save();
    await watches.startWatching(user, search.id);

    const listed = await watches.listForUser(user.id);

    expect(listed).toHaveLength(1);
    expect(listed[0]!.search.name).toBe('June somewhere warm');
    expect(listed[0]!.watch.tripSearchId).toBe(search.id);
  });

  it('shows nobody else’s watches', async () => {
    const theirs = await save(other);
    await watches.startWatching(other, theirs.id);

    expect(await watches.listForUser(user.id)).toEqual([]);
  });
});

describe('recordRun', () => {
  it('stamps the run and schedules the next one from the plan', async () => {
    const search = await save();
    const watch = await watches.startWatching(user, search.id);

    const after = await watches.recordRun(watch.id, free, 'normal');

    expect(after.lastRunAt).toBe(new Date(clock).toISOString());
    // The plan's floor decides the cadence, not the caller.
    expect(Date.parse(after.nextRunAt) - clock).toBe(
      Math.max(6, free.minRefreshIntervalHours) * 3_600_000,
    );
  });
});

describe('describing the next run', () => {
  it('says when an active watch will be looked at again', async () => {
    const search = await save();
    const watch = await watches.startWatching(user, search.id);
    await watches.recordRun(watch.id, free, 'normal');

    const [row] = await watches.listForUser(user.id);

    // A watch that cannot say when it next runs is indistinguishable from one
    // that has quietly stopped.
    expect(row!.nextRunLabel).toMatch(/In about \d+ hours?/);
  });

  it('says a paused watch is not scheduled rather than inventing a time', async () => {
    const search = await save();
    const watch = await watches.startWatching(user, search.id);
    await watches.setStatus(user, watch.id, 'paused');

    const [row] = await watches.listForUser(user.id);

    expect(row!.nextRunLabel).toBe('Not scheduled while paused');
  });

  it('says a watch already past its deadline is due now', async () => {
    const search = await save();
    await watches.startWatching(user, search.id);

    const [row] = await watches.listForUser(user.id);

    expect(row!.nextRunLabel).toBe('Due now');
  });
});

describe('what the watches list reports about history', () => {
  it('says nothing has been recorded before the first run', async () => {
    const search = await save();
    await watches.startWatching(user, search.id);

    const [row] = await watches.listForUser(user.id);

    expect(row!.lowestRecorded).toBeNull();
    expect(row!.observationCount).toBe(0);
  });

  it('reports the cheapest recorded total and how much looking is behind it', async () => {
    // "Best seen so far" means nothing without knowing how many observations
    // stand behind it. One price is not a trend.
    const search = await save();
    const watch = await watches.startWatching(user, search.id);

    for (const amount of [72000, 65000]) {
      await repositories.priceHistory.record({
        watchId: watch.id,
        componentType: 'trip_total',
        componentId: 'candidate-1',
        amount: money(amount, 'EUR'),
        providerId: 'voyagr.cost-engine',
        observedAt: new Date(clock).toISOString(),
        conditions: null,
      });
    }

    const [row] = await watches.listForUser(user.id);

    expect(row!.lowestRecorded).toEqual(money(65000, 'EUR'));
    expect(row!.observationCount).toBe(2);
  });

  it('reads the lowest in the search currency, not the lowest number', async () => {
    const search = await save();
    const watch = await watches.startWatching(user, search.id);

    for (const [amount, currency] of [
      [65000, 'EUR'],
      [40000, 'GBP'],
    ] as const) {
      await repositories.priceHistory.record({
        watchId: watch.id,
        componentType: 'trip_total',
        componentId: 'candidate-1',
        amount: money(amount, currency),
        providerId: 'voyagr.cost-engine',
        observedAt: new Date(clock).toISOString(),
        conditions: null,
      });
    }

    // The saved search is in EUR, so GBP 400 is not its best price.
    expect((await watches.listForUser(user.id))[0]!.lowestRecorded).toEqual(money(65000, 'EUR'));
  });
});
