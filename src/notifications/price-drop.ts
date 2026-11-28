import { computeBaseline, type RouteObservation } from '@/core/alerts/baseline';
import { detectPriceDrop, type DetectReason, type PriceDropAlert } from '@/core/alerts/detect';
import { format, money } from '@/core/money';
import type {
  NotificationRecord,
  PriceAlertRecord,
  Repositories,
  TravelWatchRecord,
} from '@/db/repository';
import { renderEmail } from '@/email/templates';
import type { EmailProvider } from '@/email/types';
import { getEnv } from '@/lib/env';
import { getLogger } from '@/lib/logger';
import { deliverNotification } from './deliver';
import type { NotificationChannel } from './types';

/**
 * Raise a price-drop alert for a watch, once a lookup has actually produced a new price.
 *
 * Observations are recorded ONLY when a lookup really happened (a user request or the lazy
 * recommendation generation). Nothing here polls, and nothing here calls a provider: the caller
 * hands in the observations it already holds. The decision is `src/core/alerts`; this module only
 * persists it and tells the user.
 *
 * Channels: the in-app notification (always, it is the record), web push when the channel is
 * configured, and email through whichever `EmailProvider` is injected. Tests inject the console
 * driver and a stub channel; nothing here constructs a real transport.
 */

const log = getLogger('notifications.price-drop');

export interface PriceDropInput {
  readonly repositories: Repositories;
  readonly watch: TravelWatchRecord;
  /** `ORIGIN-DESTINATION-YYYY-MM`. */
  readonly routeKey: string;
  /** Stored observations of this route, any month or currency; the baseline filters them. */
  readonly observations: readonly RouteObservation[];
  /** The observation the lookup just produced. */
  readonly latest: RouteObservation;
  /** Current instant, UTC ISO. */
  readonly now: string;
  /** Where the alert lands, app-relative. */
  readonly url?: string;
  readonly channel?: NotificationChannel;
  readonly emailProvider: EmailProvider;
}

export interface PriceDropOutcome {
  readonly raised: boolean;
  readonly reason: DetectReason | 'alerts_off' | 'no_user';
  readonly alert?: PriceAlertRecord;
  readonly notification?: NotificationRecord;
  readonly emailed?: boolean;
}

function wording(alert: PriceDropAlert): { title: string; body: string } {
  const drop = format(money(alert.dropMinor, alert.currency));
  const now = format(money(alert.newMinor, alert.currency));
  const median = format(money(alert.medianMinor, alert.currency));
  return {
    title: `Price drop: ${drop} below the usual`,
    body: `Cheapest now ${now}, against a usual ${median} on ${alert.routeKey} (${alert.sampleCount} lookups in the last 30 days).`,
  };
}

export async function raisePriceDropAlert(input: PriceDropInput): Promise<PriceDropOutcome> {
  const { repositories, watch, routeKey, latest, now } = input;

  const preferences = await repositories.alertPreferences.find(watch.userId);
  if (preferences && !preferences.priceDropAlerts) {
    return { raised: false, reason: 'alerts_off' };
  }

  // The baseline excludes the observation being judged, or a price would be compared with itself.
  const baseline = computeBaseline(
    input.observations.filter((o) => o.id !== latest.id),
    { month: latest.month, currency: latest.currency, now },
  );
  const recentAlerts = await repositories.priceAlerts.listForRoute(watch.id, routeKey);

  const result = detectPriceDrop({
    watchId: watch.id,
    routeKey,
    observationId: latest.id,
    newMinor: latest.cheapestMinor,
    currency: latest.currency,
    baseline,
    recentAlerts,
    now,
  });
  if (!result.alert) return { raised: false, reason: result.reason };

  const { title, body } = wording(result.alert);
  const url = input.url ?? '/watches';
  const notification = await repositories.notifications.create({
    userId: watch.userId,
    watchId: watch.id,
    severity: 'interesting',
    title,
    body,
    url,
    readAt: null,
    deliveredAt: null,
  });

  const alert = await repositories.priceAlerts.record({
    watchId: watch.id,
    routeKey,
    observationId: latest.id,
    notificationId: notification.id,
    currency: result.alert.currency,
    newMinor: result.alert.newMinor,
    medianMinor: result.alert.medianMinor,
    createdAt: now,
  });
  if (!alert) return { raised: false, reason: 'duplicate_observation' };

  await deliverNotification(notification.id, {
    repositories,
    ...(input.channel ? { channel: input.channel } : {}),
  });

  const emailed = await sendEmail(input, title, body, url);
  return { raised: true, reason: 'alert', alert, notification, emailed };
}

async function sendEmail(
  input: PriceDropInput,
  title: string,
  body: string,
  url: string,
): Promise<boolean> {
  const user = await input.repositories.users.findById(input.watch.userId);
  if (!user) return false;
  try {
    const base = getEnv().NEXT_PUBLIC_APP_URL.replace(/\/+$/, '');
    const rendered = renderEmail({
      subject: title,
      preheader: body,
      heading: title,
      blocks: [{ type: 'paragraph', text: body }],
      button: { label: 'See the trip', url: `${base}${url}` },
      reason:
        'You get this because you watch this trip. Turn price-drop alerts off in your account.',
    });
    const sent = await input.emailProvider.send({
      to: user.email,
      subject: rendered.subject,
      text: rendered.text,
      html: rendered.html,
      headers: { 'List-Unsubscribe': `<${base}/account>` },
    });
    return sent.ok;
  } catch (error) {
    log.warn({ error: error instanceof Error ? error.message : 'unknown' }, 'alert email failed');
    return false;
  }
}
