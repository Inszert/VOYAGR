import { describe, expect, it } from 'vitest';
import { createMemoryRepositories } from './memory';
import { recordVisitorSearch } from '@/search/visitor-search';

const MINUTE = 60_000;
const DAY = 86_400_000;

function setup() {
  const clock = { now: Date.parse('2027-01-10T12:00:00Z') };
  const repos = createMemoryRepositories({ now: () => clock.now });
  return { clock, repo: repos.visitorSearches };
}

const event = {
  destinationCodes: ['LIS'],
  checkIn: '2027-02-09' as const,
  checkOut: '2027-02-13' as const,
  partySize: 2,
  currency: 'EUR',
  userAgent: 'Mozilla/5.0 (Windows NT 10.0) Chrome/130',
};

describe('visitor searches', () => {
  it('stores a search once within ten minutes', async () => {
    const { clock, repo } = setup();
    expect(await recordVisitorSearch(event, repo)).toBe(1);
    clock.now += 9 * MINUTE;
    expect(await recordVisitorSearch(event, repo)).toBe(0);
    clock.now += 2 * MINUTE;
    expect(await recordVisitorSearch(event, repo)).toBe(1);
    expect(await repo.listRecent({ limit: 10 })).toHaveLength(2);
  });

  it('does not store a search with no destination', async () => {
    const { repo } = setup();
    expect(await recordVisitorSearch({ ...event, destinationCodes: [] }, repo)).toBe(0);
    expect(await recordVisitorSearch({ ...event, destinationCodes: ['anywhere'] }, repo)).toBe(0);
    expect(await repo.listRecent({ limit: 10 })).toEqual([]);
  });

  it('does not store a bot', async () => {
    const { repo } = setup();
    expect(await recordVisitorSearch({ ...event, userAgent: 'Googlebot/2.1' }, repo)).toBe(0);
    expect(await recordVisitorSearch({ ...event, userAgent: null }, repo)).toBe(0);
  });

  it('lists only the last 30 days, per destination', async () => {
    const { clock, repo } = setup();
    await recordVisitorSearch(event, repo);
    clock.now += 31 * DAY;
    await recordVisitorSearch({ ...event, destinationCodes: ['PAR'] }, repo);
    const recent = await repo.listRecent({ limit: 10 });
    expect(recent.map((search) => search.destinationCode)).toEqual(['PAR']);
    expect(await repo.listRecent({ destinationCodes: ['LIS'], limit: 10 })).toEqual([]);
    expect(recent[0]).not.toHaveProperty('dedupeKey');
  });
});
