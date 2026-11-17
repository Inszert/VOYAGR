import { describe, expect, it, vi } from 'vitest';
import { buildProfile } from '@/core/trip/test-support';
import { createMemoryRepositories } from '@/db/memory';
import { recordSearch, searchRecordId, RECORD_SEARCH_INTERVAL_MS } from './record-search';

const USER = '11111111-1111-4111-8111-111111111111';

async function withUser() {
  const repositories = createMemoryRepositories();
  const user = await repositories.users
    .create({
      id: USER,
      email: 'a@example.com',
    } as never)
    .catch(() => null);
  void user;
  return repositories.tripSearches;
}

describe('recordSearch', () => {
  const profile = buildProfile();

  it('writes one row, then skips an identical search inside a minute', async () => {
    const repo = await withUser();
    const t = Date.now();

    await recordSearch(repo, { userId: USER, profile, destinations: ['AYT'], now: t });
    await recordSearch(repo, { userId: USER, profile, destinations: ['AYT'], now: t + 1000 });

    const rows = await repo.listByUser(USER);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).toBe(searchRecordId(USER, profile, ['AYT']));
  });

  it('refreshes the same row after the interval', async () => {
    const repo = await withUser();
    const spy = vi.spyOn(repo, 'upsert');
    const t = Date.now();

    await recordSearch(repo, { userId: USER, profile, destinations: ['AYT'], now: t });
    await recordSearch(repo, {
      userId: USER,
      profile,
      destinations: ['AYT'],
      now: t + RECORD_SEARCH_INTERVAL_MS + 5000,
    });

    expect(spy).toHaveBeenCalledTimes(2);
    expect(await repo.listByUser(USER)).toHaveLength(1);
  });

  it('keeps different searches and different users apart', () => {
    expect(searchRecordId(USER, profile, ['AYT'])).not.toBe(searchRecordId(USER, profile, ['CHQ']));
    expect(searchRecordId(USER, profile, ['AYT'])).not.toBe(
      searchRecordId('22222222-2222-4222-8222-222222222222', profile, ['AYT']),
    );
    expect(searchRecordId(USER, profile, ['AYT'])).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it('never throws when the repository fails', async () => {
    const repo = await withUser();
    vi.spyOn(repo, 'findById').mockRejectedValue(new Error('db down'));
    await expect(
      recordSearch(repo, { userId: USER, profile, destinations: ['AYT'] }),
    ).resolves.toBeUndefined();
  });

  it('records nothing without a destination', async () => {
    const repo = await withUser();
    await recordSearch(repo, { userId: USER, profile, destinations: [] });
    expect(await repo.listByUser(USER)).toHaveLength(0);
  });
});
