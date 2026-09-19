import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryRepositories } from '@/db/memory';
import { deliverNotification } from './deliver';
import type { NotificationChannel } from './types';
import type { Repositories } from '@/db/repository';

/**
 * Delivering a recorded alert.
 *
 * Recording and delivering are separate steps, and these tests are mostly about
 * why: a push that fails, is unconfigured or is retried must never change what
 * the user is told happened.
 */

let repositories: Repositories;
const CLOCK = Date.parse('2026-09-19T12:00:00.000Z');

function channelReturning(
  status: 'delivered' | 'failed' | 'skipped' | 'expired',
  recipients = 1,
): NotificationChannel & { send: ReturnType<typeof vi.fn> } {
  const send = vi.fn(async () => ({ channel: 'web-push', status, recipients }));
  return { id: 'web-push', displayName: 'Web Push', isConfigured: () => true, send } as never;
}

async function anAlert(overrides: Record<string, unknown> = {}) {
  return repositories.notifications.create({
    userId: 'user-1',
    watchId: 'watch-1',
    severity: 'important',
    title: '€70.00 off Greek islands',
    body: 'Chania is now €610.00 total.',
    url: '/?origins=VIE',
    readAt: null,
    deliveredAt: null,
    ...overrides,
  });
}

beforeEach(() => {
  repositories = createMemoryRepositories();
});

describe('deliverNotification', () => {
  it('sends the recorded alert and stamps it delivered', async () => {
    const alert = await anAlert();
    const channel = channelReturning('delivered');

    const result = await deliverNotification(alert.id, {
      repositories,
      channel,
      now: () => CLOCK,
    });

    expect(result.status).toBe('delivered');
    expect(channel.send).toHaveBeenCalledWith(
      { userId: 'user-1' },
      expect.objectContaining({
        title: alert.title,
        body: alert.body,
        url: '/?origins=VIE',
        severity: 'important',
        // Grouped per watch, so one trip cannot stack five notifications on a
        // phone while its price wobbles.
        tag: 'watch-watch-1',
      }),
    );

    expect((await repositories.notifications.findById(alert.id))?.deliveredAt).toBe(
      new Date(CLOCK).toISOString(),
    );
  });

  it('does not send the same alert twice when a job is retried', async () => {
    const alert = await anAlert({ deliveredAt: '2026-09-19T11:00:00.000Z' });
    const channel = channelReturning('delivered');

    const result = await deliverNotification(alert.id, { repositories, channel });

    expect(result.status).toBe('skipped');
    expect(channel.send).not.toHaveBeenCalled();
  });

  it('leaves the alert undelivered when the push fails', async () => {
    // The record is the alert; a push is one way of pointing at it. A failure
    // must not be recorded as "we told you".
    const alert = await anAlert();

    const result = await deliverNotification(alert.id, {
      repositories,
      channel: channelReturning('failed', 0),
    });

    expect(result.status).toBe('failed');
    expect((await repositories.notifications.findById(alert.id))?.deliveredAt).toBeNull();
  });

  it('skips quietly when no channel is configured', async () => {
    const alert = await anAlert();
    const unconfigured = {
      id: 'web-push',
      displayName: 'Web Push',
      isConfigured: () => false,
      send: vi.fn(),
    } as never as NotificationChannel;

    const result = await deliverNotification(alert.id, { repositories, channel: unconfigured });

    expect(result.status).toBe('skipped');
    // The alert still exists and is still visible; only the push was skipped.
    expect(await repositories.notifications.findById(alert.id)).not.toBeNull();
  });

  it('does not throw when the notification is gone', async () => {
    const result = await deliverNotification('nope', {
      repositories,
      channel: channelReturning('delivered'),
    });

    expect(result.status).toBe('not-found');
  });

  it('falls back to the watches page when an alert has no link', async () => {
    const alert = await anAlert({ url: null });
    const channel = channelReturning('delivered');

    await deliverNotification(alert.id, { repositories, channel });

    expect(channel.send).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ url: '/watches' }),
    );
  });
});
