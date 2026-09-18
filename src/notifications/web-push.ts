import { getEnv } from '@/lib/env';
import { getLogger } from '@/lib/logger';
import { getRepositories } from '@/db';
import type {
  DeliveryResult,
  DeliveryTarget,
  NotificationChannel,
  NotificationPayload,
} from './types';

/**
 * Web Push channel.
 *
 * The first notification transport, per the specification (sections 18 and 20)
 * and the setup checklist. Two design points:
 *
 *  - VAPID keys are optional. With none configured the channel reports itself
 *    unconfigured and returns `skipped`, so the foundation runs without keys.
 *  - `web-push` is imported dynamically, so the dependency is only loaded when
 *    a push is actually sent.
 *
 * Subscription keys are credentials. They are never logged, and endpoints are
 * truncated in log output.
 */

const log = getLogger('notifications.web-push');

/** HTTP statuses that mean the subscription is dead and should be dropped. */
const GONE_STATUSES = new Set([404, 410]);

function truncateEndpoint(endpoint: string): string {
  return `${endpoint.slice(0, 40)}...`;
}

export class WebPushChannel implements NotificationChannel {
  readonly id = 'web-push';
  readonly displayName = 'Web Push';

  isConfigured(): boolean {
    const env = getEnv();
    return Boolean(env.NEXT_PUBLIC_VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY);
  }

  async send(target: DeliveryTarget, payload: NotificationPayload): Promise<DeliveryResult> {
    if (!this.isConfigured()) {
      log.debug('web push is not configured; delivery skipped');
      return {
        channel: this.id,
        status: 'skipped',
        recipients: 0,
        message: 'VAPID keys are not configured.',
      };
    }

    const env = getEnv();
    const repositories = getRepositories();
    const subscriptions = await repositories.pushSubscriptions.listByUser(target.userId);

    if (subscriptions.length === 0) {
      return {
        channel: this.id,
        status: 'skipped',
        recipients: 0,
        message: 'The user has no push subscriptions.',
      };
    }

    const webPush = await import('web-push');
    webPush.setVapidDetails(
      env.VAPID_SUBJECT,
      // Both are non-null here: `isConfigured()` was checked above.
      env.NEXT_PUBLIC_VAPID_PUBLIC_KEY as string,
      env.VAPID_PRIVATE_KEY as string,
    );

    const body = JSON.stringify(payload);
    let delivered = 0;
    let failed = 0;

    // Settled, not all: one dead endpoint must not cancel the rest.
    const results = await Promise.allSettled(
      subscriptions.map(async (subscription) => {
        try {
          await webPush.sendNotification(
            { endpoint: subscription.endpoint, keys: subscription.keys },
            body,
          );
          delivered += 1;
        } catch (error) {
          failed += 1;

          const statusCode = (error as { statusCode?: number }).statusCode;

          if (statusCode !== undefined && GONE_STATUSES.has(statusCode)) {
            // The browser revoked this subscription; stop trying it.
            await repositories.pushSubscriptions.deleteByEndpoint(subscription.endpoint);
            log.info(
              { endpoint: truncateEndpoint(subscription.endpoint), statusCode },
              'removed an expired push subscription',
            );
            return;
          }

          log.warn(
            { endpoint: truncateEndpoint(subscription.endpoint), statusCode },
            'push delivery failed',
          );
        }
      }),
    );

    const rejected = results.filter((result) => result.status === 'rejected').length;
    if (rejected > 0) {
      log.error({ rejected }, 'unexpected rejection while sending push notifications');
    }

    if (delivered === 0) {
      return {
        channel: this.id,
        status: failed > 0 ? 'failed' : 'skipped',
        recipients: 0,
        message: 'No push endpoint accepted the notification.',
      };
    }

    return { channel: this.id, status: 'delivered', recipients: delivered };
  }
}

export function createWebPushChannel(): NotificationChannel {
  return new WebPushChannel();
}
