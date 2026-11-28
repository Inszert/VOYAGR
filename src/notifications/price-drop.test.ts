import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RouteObservation } from '@/core/alerts/baseline';
import { money } from '@/core/money';
import { createMemoryRepositories } from '@/db/memory';
import type { Repositories, TravelWatchRecord } from '@/db/repository';
import { createConsoleEmailProvider } from '@/email/console';
import type { EmailProvider } from '@/email/types';
import { raisePriceDropAlert } from './price-drop';
import type { NotificationChannel } from './types';

const NOW = '2027-01-31T12:00:00.000Z';
const ROUTE = 'VIE-LIS-2027-03';

let repositories: Repositories;
let watch: TravelWatchRecord;

function history(count: number, cheapestMinor = 20000): RouteObservation[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `h${i}`,
    cheapestMinor,
    currency: 'EUR',
    observedAt: `2027-01-${String(10 + i).padStart(2, '0')}T08:00:00.000Z`,
    month: '2027-03',
  }));
}

function latest(id: string, cheapestMinor: number): RouteObservation {
  return { id, cheapestMinor, currency: 'EUR', observedAt: NOW, month: '2027-03' };
}

function stubChannel() {
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
  return { channel, send };
}

beforeEach(async () => {
  repositories = createMemoryRepositories();
  const user = await repositories.users.create({ id: 'u1', email: 'a@example.test', plan: 'free' });
  const search = await repositories.tripSearches.create({
    id: 's1',
    userId: user.id,
    name: 'Lisbon',
    profile: {} as never,
    createdFromQuery: null,
  } as never);
  watch = await repositories.travelWatches.create({
    id: 'w1',
    userId: user.id,
    tripSearchId: search.id,
    status: 'active',
    priority: 'normal',
    lastRunAt: null,
    nextRunAt: NOW,
    bestKnownTotal: money(20000, 'EUR'),
  } as never);
});

function run(over: Partial<Parameters<typeof raisePriceDropAlert>[0]> = {}) {
  const { channel, send } = stubChannel();
  const emailProvider = createConsoleEmailProvider();
  const sendEmail = vi.spyOn(emailProvider, 'send');
  const promise = raisePriceDropAlert({
    repositories,
    watch,
    routeKey: ROUTE,
    observations: history(6),
    latest: latest('new1', 15000),
    now: NOW,
    channel,
    emailProvider,
    ...over,
  });
  return { promise, send, sendEmail, emailProvider };
}

describe('raisePriceDropAlert', () => {
  it('records the notification and the alert, pushes to the stub and emails the console driver', async () => {
    const { promise, send, sendEmail, emailProvider } = run();
    const outcome = await promise;

    expect(outcome.raised).toBe(true);
    expect(emailProvider.sendsRealEmail).toBe(false);
    expect(send).toHaveBeenCalledTimes(1);
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(outcome.emailed).toBe(true);

    const feed = await repositories.notifications.listByUser('u1');
    expect(feed).toHaveLength(1);
    expect(feed[0]?.deliveredAt).not.toBeNull();
    const alerts = await repositories.priceAlerts.listForRoute('w1', ROUTE);
    expect(alerts[0]).toMatchObject({ observationId: 'new1', newMinor: 15000, medianMinor: 20000 });
  });

  it('raises nothing with fewer than 5 observations', async () => {
    const { promise, send } = run({ observations: history(4) });
    expect(await promise).toMatchObject({ raised: false, reason: 'no_baseline' });
    expect(send).not.toHaveBeenCalled();
    expect(await repositories.notifications.listByUser('u1')).toHaveLength(0);
  });

  it('does not alert twice for the same observation, nor again within 24 hours', async () => {
    expect((await run().promise).raised).toBe(true);
    expect(await run().promise).toMatchObject({ raised: false, reason: 'duplicate_observation' });
    expect(await run({ latest: latest('new2', 14000) }).promise).toMatchObject({
      raised: false,
      reason: 'duplicate_window',
    });
    expect(await repositories.notifications.listByUser('u1')).toHaveLength(1);
  });

  it('respects a user who turned price-drop alerts off', async () => {
    await repositories.alertPreferences.save('u1', {
      homeAirport: null,
      destinations: [],
      budget: null,
      earliestDeparture: null,
      latestDeparture: null,
      priceDropAlerts: false,
    });
    const { promise, send, sendEmail } = run();
    expect(await promise).toMatchObject({ raised: false, reason: 'alerts_off' });
    expect(send).not.toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('still leaves the in-app alert when the email driver fails', async () => {
    const failing: EmailProvider = {
      id: 'stub',
      sendsRealEmail: false,
      send: async () => {
        throw new Error('boom');
      },
    };
    const outcome = await run({ emailProvider: failing }).promise;
    expect(outcome.raised).toBe(true);
    expect(outcome.emailed).toBe(false);
    expect(await repositories.notifications.listByUser('u1')).toHaveLength(1);
  });
});
