import type { NotificationRecord, Repositories } from '@/db/repository';

/**
 * The in-app notification centre's view of a user's alerts.
 *
 * The alerts are the `notifications` rows the watch pipeline already writes the
 * moment a deal is detected - persisting is not a separate step from deciding,
 * which is why a push that fails still leaves the alert here. This module only
 * shapes them for the bell: what is listed, and what counts as unread.
 */

/** How many alerts the centre lists. The unread count is of these, so the two always agree. */
export const NOTIFICATION_LIST_LIMIT = 30;

export interface NotificationView {
  readonly id: string;
  readonly severity: NotificationRecord['severity'];
  readonly title: string;
  readonly body: string;
  /** App-relative, or null when the alert has no destination. */
  readonly url: string | null;
  readonly createdAt: string;
  readonly read: boolean;
}

export interface NotificationFeed {
  readonly unread: number;
  readonly items: readonly NotificationView[];
}

export async function loadNotificationFeed(
  repositories: Pick<Repositories, 'notifications'>,
  userId: string,
): Promise<NotificationFeed> {
  const records = await repositories.notifications.listByUser(userId, NOTIFICATION_LIST_LIMIT);

  const items = records.map((record): NotificationView => ({
    id: record.id,
    severity: record.severity,
    title: record.title,
    body: record.body,
    url: record.url,
    createdAt: record.createdAt,
    read: record.readAt !== null,
  }));

  return { unread: items.filter((item) => !item.read).length, items };
}
