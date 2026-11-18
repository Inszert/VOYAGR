import { describe, expect, it } from 'vitest';
import { getRepositories, resetRepositories } from '@/db';
import type { LiteApiRatesRow } from '@/db/repository';
import { STORED_SCHEMA_VERSION, toStoredRates } from '@/liteapi-snapshot/stored-schema';
import { aProperty, aRate } from '@/liteapi-snapshot/test-support';
import { loadRecommendations } from './recommendations';

const NOW = Date.parse('2027-01-10T12:00:00Z');
const HOUR = 3_600_000;

function row(overrides: Partial<LiteApiRatesRow> & { rates: unknown }): LiteApiRatesRow {
  return {
    destinationCode: 'LIS',
    checkIn: '2027-02-09',
    checkOut: '2027-02-13',
    adults: 2,
    children: 0,
    rooms: 1,
    currency: 'EUR',
    guestNationality: 'US',
    environment: 'sandbox',
    schemaVersion: STORED_SCHEMA_VERSION,
    observedAt: new Date(NOW - HOUR).toISOString(),
    expiresAt: new Date(NOW + 20 * HOUR).toISOString(),
    runId: 'seed',
    ...overrides,
  } as LiteApiRatesRow;
}

function deps(rows: LiteApiRatesRow[]) {
  return {
    repository: { recentRates: async () => rows },
    environment: 'sandbox' as const,
    now: NOW,
  };
}

describe('loadRecommendations', () => {
  it('gives no cards for an empty database', async () => {
    resetRepositories();
    const cards = await loadRecommendations({ seed: 's', count: 3 });
    expect(cards).toEqual([]);
    expect(getRepositories()).toBeDefined();
  });

  it('excludes an expired row', async () => {
    const expired = row({
      rates: toStoredRates([{ property: aProperty, rates: [aRate] }]),
      expiresAt: new Date(NOW - HOUR).toISOString(),
    });
    expect(await loadRecommendations({ seed: 's', count: 3 }, deps([expired]))).toEqual([]);
  });

  it('never puts a pay-at-hotel tax in the price label', async () => {
    const live = row({ rates: toStoredRates([{ property: aProperty, rates: [aRate] }]) });
    const [card] = await loadRecommendations({ seed: 's', count: 1 }, deps([live]));
    expect(card?.price?.total).toEqual({ amount: 33333, currency: 'EUR' });
    expect(card?.price?.totalLabel).toContain('333.33');
    expect(card?.price?.totalLabel).not.toContain('337.33');
    expect(card?.price?.totalLabel).not.toContain('4.00');
  });

  it('flags sandbox rows as test prices', async () => {
    const live = row({ rates: toStoredRates([{ property: aProperty, rates: [aRate] }]) });
    const [card] = await loadRecommendations({ seed: 's', count: 1 }, deps([live]));
    expect(card?.testPrices).toBe(true);
    expect(card?.price?.testPrices).toBe(true);
  });

  it('keeps content with no rate as a card with price null', async () => {
    const bare = row({ rates: toStoredRates([{ property: aProperty, rates: [] }]) });
    const [card] = await loadRecommendations({ seed: 's', count: 1 }, deps([bare]));
    expect(card?.name).toBe('Hotel Alfama');
    expect(card?.price).toBeNull();
    expect(card?.hasPhoto).toBe(true);
  });

  it('is deterministic for a seed and caps at count', async () => {
    const other = { ...aProperty, id: 'liteapi:lp2', name: 'Other' };
    const live = row({
      rates: toStoredRates([
        { property: aProperty, rates: [aRate] },
        { property: other, rates: [] },
      ]),
    });
    const a = await loadRecommendations({ seed: 'x', count: 1 }, deps([live]));
    const b = await loadRecommendations({ seed: 'x', count: 1 }, deps([live]));
    expect(a).toHaveLength(1);
    expect(a).toEqual(b);
  });
});

describe('loadRecommendations from visitor searches', () => {
  const lisRow = () => row({ rates: toStoredRates([{ property: aProperty, rates: [aRate] }]) });
  const otherProperty = { ...aProperty, id: 'liteapi:par1', name: 'Hotel Seine' };
  const parRow = () =>
    row({
      destinationCode: 'PAR',
      rates: toStoredRates([{ property: otherProperty, rates: [aRate] }]),
    });
  const searches = (codes: string[]) => ({
    listRecent: async () =>
      codes.map((destinationCode) => ({
        destinationCode,
        checkIn: '2027-02-09' as const,
        checkOut: '2027-02-13' as const,
        partySize: 2,
        currency: 'EUR',
        searchedAt: new Date(NOW).toISOString(),
      })),
  });

  it('recommends the destination a visitor recently searched', async () => {
    const cards = await loadRecommendations(
      { seed: 's', count: 5 },
      { ...deps([lisRow(), parRow()]), searches: searches(['PAR']) },
    );
    expect(cards.map((card) => card.name)).toEqual(['Hotel Seine']);
  });

  it('uses the stored rates when there are no recent searches', async () => {
    const cards = await loadRecommendations(
      { seed: 's', count: 5 },
      { ...deps([lisRow(), parRow()]), searches: searches([]) },
    );
    expect(cards.map((card) => card.name).sort()).toEqual(['Hotel Alfama', 'Hotel Seine']);
  });
});
