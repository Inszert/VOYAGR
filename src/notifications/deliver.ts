import { getLogger } from '@/lib/logger';
import { createWebPushChannel } from './web-push';
import type { NotificationChannel } from './types';
import type { Job } from '@/queue/types';
import type { Repositories } from '@/db/repository';

/**
 * Delivering an alert that has already been decided on and recorded.
 *
 * Separate from deciding, on purpose. The notification exists in the database
 * the moment a deal is detected; delivery is an attempt to get it in front of
 * someone, and a failed attempt must not mean they never learn about it. The
 * record is the alert; a push is one way of pointing at it.
 *
 * `deliveredAt` is stamped only on a genuine delivery, so "we told you" is a
 * claim backed by something having actually been sent.
 */

const log = getLogger('notifications.deliver');

export interface DeliverDependencies {
  readonly repositories: Repositories;
  /** Injectable so a test can deliver without a push service. */
  readonly channel?: NotificationChannel;
  readonly now?: () => number;
}

export interface DeliveryOutcome {
  readonly notificationId: string;
  readonly status: 'delivered' | 'skipped' | 'failed' | 'expired' | 'not-found';
  readonly recipients: number;
}

/**
 * Deliver one recorded notification.
 *
 * Never throws for an ordinary failure. An unreachable push service is an
 * expected outcome of the internet, not a reason to fail a job and retry it
 * three times into the same silence.
 */
export async function deliverNotification(
  notificationId: string,
  dependencies: DeliverDependencies,
): Promise<DeliveryOutcome> {
  const { repositories } = dependencies;
  const now = dependencies.now ?? Date.now;
  const channel = dependencies.channel ?? createWebPushChannel();

  const notification = await repositories.notifications.findById(notificationId);

  if (!notification) {
    log.warn({ notificationId }, 'delivery skipped: notification no longer exists');
    return { notificationId, status: 'not-found', recipients: 0 };
  }

  if (notification.deliveredAt) {
    // A retried job must not push the same alert twice.
    return { notificationId, status: 'skipped', recipients: 0 };
  }

  if (!channel.isConfigured()) {
    log.warn({ notificationId, channel: channel.id }, 'delivery skipped: channel not configured');
    return { notificationId, status: 'skipped', recipients: 0 };
  }

  const result = await channel.send(
    { userId: notification.userId },
    {
      severity: notification.severity,
      title: notification.title,
      body: notification.body,
      url: notification.url ?? '/watches',
      // Grouped by watch, so one trip cannot stack five notifications on a
      // phone while its price wobbles.
      ...(notification.watchId ? { tag: `watch-${notification.watchId}` } : {}),
    },
  );

  if (result.status === 'delivered') {
    await repositories.notifications.markDelivered(notification.id, new Date(now()).toISOString());
  }

  log.info(
    { notificationId, status: result.status, recipients: result.recipients },
    'notification delivery attempted',
  );

  return { notificationId, status: result.status, recipients: result.recipients };
}

/** The queue handler. Thin: the behaviour is testable without a queue. */
export function createDeliveryHandler(dependencies: DeliverDependencies) {
  return async (job: Job<'notification.deliver'>): Promise<void> => {
    await deliverNotification(job.payload.notificationId, dependencies);
  };
}
