import { describe, expect, it, vi } from 'vitest';
import { MemoryCacheStore } from '@/cache/memory';
import { money } from '@/core/money';
import type { FlightOffer } from '@/core/trip/types';
import { createMemoryRepositories } from '@/db/memory';
import { createConsoleEmailProvider } from '@/email/console';
import type { NotificationChannel } from '@/notifications/types';
import { ok } from '@/lib/result';
import type { FlightProvider } from '@/providers/types';
import { KiwiReadPath } from '@/providers/flights/kiwi-read-path';
import { createPriceDropObserver } from './price-drop-observer';

const HOUR = 3_600_000;
let clock = Date.parse('2027-01-10T12:00:00.000Z');
const now = () => clock;

const LOOKUP = {
  origin: 'VIE',
  destination: 'LIS',
  departureDate: '2027-03-09',
  returnDate: '2027-03-13',
  adults: 2,
  currency: 'EUR',
} as const;

const priced = (amount: number) =>
  ({ id: `o${amount}`, price: money(amount, 'EUR') }) as unknown as FlightOffer;

async function setup(startsAt = '2027-01-10T12:00:00.000Z') {
  clock = Date.parse(startsAt);
  const repositories = createMemoryRepositories({ now });
  const user = await repositories.users.create({ id: 'u1', email: 'a@example.test', plan: 'free' });
  const search = await repositories.tripSearches.create({
    id: 's1',
    userId: user.id,
    name: 'Lisbon',
    profile: { origins: ['VIE'] } as never,
    destinations: ['LIS'],
  });
  await repositories.travelWatches.create({
    id: 'w1',
    userId: user.id,
    tripSearchId: search.id,
    status: 'active',
    priority: 'normal',
    lastRunAt: null,
    nextRunAt: new Date(clock).toISOString(),
    bestKnownTotal: null,
  });

  const send = vi.fn(async () => ({
    channel: 'stub',
    status: 'delivered' as const,
    recipients: 1,
  }));
  const channel: NotificationChannel = {
    id: 'stub',
    displayName: 'Stub',
    isConfigured: () => true,
    send,
  };
  const email = createConsoleEmailProvider();
  const emailSend = vi.spyOn(email, 'send');
  const observer = createPriceDropObserver({
    repositories: () => repositories,
    emailProvider: () => email,
    channel,
  });
  const observed = vi.fn(observer);

  let amounts: number[] = [30000];
  const searchFlights = vi.fn(async () => ok({ items: amounts.map(priced), nextCursor: null }));
  const path = new KiwiReadPath({
    provider: { searchFlights } as unknown as FlightProvider,
    cache: new MemoryCacheStore({ now }),
    repository: repositories.kiwiOffers,
    now,
    onFreshObservation: observed,
  });
  const lookupAfter = async (hours: number, prices: number[]) => {
    clock += hours * HOUR;
    amounts = prices;
    return path.lookup(LOOKUP);
  };
  const alerts = () => repositories.priceAlerts.listForRoute('w1', 'VIE-LIS-2027-03');
  return { path, searchFlights, observed, lookupAfter, alerts, emailSend, repositories };
}

describe('price-drop observer on the lookup path', () => {
  it('records one observation per real lookup', async () => {
    const t = await setup();
    await t.lookupAfter(0, [30000]);
    expect(t.searchFlights).toHaveBeenCalledTimes(1);
    expect(t.observed).toHaveBeenCalledTimes(1);
  });

  it('records none on a cache hit', async () => {
    const t = await setup();
    await t.lookupAfter(0, [30000]);
    await t.lookupAfter(1, [30000]);
    expect(t.searchFlights).toHaveBeenCalledTimes(1);
    expect(t.observed).toHaveBeenCalledTimes(1);
  });

  it('gives no alert with fewer than five earlier observations', async () => {
    const t = await setup();
    for (let i = 0; i < 4; i++) await t.lookupAfter(13, [30000]);
    await t.lookupAfter(13, [10000]);
    expect(await t.alerts()).toHaveLength(0);
  });

  it('alerts once on a real drop through the console driver and a stub channel', async () => {
    const t = await setup();
    for (let i = 0; i < 5; i++) await t.lookupAfter(13, [30000]);
    expect(await t.alerts()).toHaveLength(0);

    await t.lookupAfter(13, [20000, 25000]);
    expect(await t.alerts()).toHaveLength(1);
    expect(t.emailSend).toHaveBeenCalledTimes(1);
    const notes = await t.repositories.notifications.listByUser('u1');
    expect(notes).toHaveLength(1);

    // The same observation is never alerted twice, and a further drop inside 24 h is held back.
    const last = t.observed.mock.calls.at(-1)![0];
    await t.observed(last);
    expect(await t.alerts()).toHaveLength(1);
    await t.lookupAfter(13, [15000]);
    expect(await t.alerts()).toHaveLength(1);
  });

  it('does not alert a watch on another route', async () => {
    const t = await setup();
    const other = createPriceDropObserver({
      repositories: () => t.repositories,
      emailProvider: () => createConsoleEmailProvider(),
    });
    for (let i = 0; i < 6; i++) {
      await other({
        key: { ...LOOKUP, destination: 'OPO' },
        offers: [priced(i === 5 ? 10000 : 30000)],
        observedAt: new Date(clock + i * 13 * HOUR).toISOString(),
      });
    }
    expect(await t.repositories.notifications.listByUser('u1')).toHaveLength(0);
  });
});
