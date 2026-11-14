'use server';

import { getCurrentUser } from '@/auth/current-user';
import { getRepositories } from '@/db';
import { NOTIFICATION_LIST_LIMIT } from '@/notifications/in-app';

/**
 * Marking in-app notifications as read.
 *
 * Server Actions rather than route handlers, for the CSRF reason in
 * `src/app/actions/auth.ts`. The user comes from the session and a
 * notification is only touched if it is theirs: an id in a request is a claim,
 * not an authorisation.
 */

export async function markNotificationReadAction(id: string): Promise<void> {
  const user = await getCurrentUser();
  if (!user) return;

  const { notifications } = getRepositories();
  const notification = await notifications.findById(id);

  if (notification?.userId === user.id && notification.readAt === null) {
    await notifications.markRead(id, new Date().toISOString());
  }
}

export async function markAllNotificationsReadAction(): Promise<void> {
  const user = await getCurrentUser();
  if (!user) return;

  const { notifications } = getRepositories();
  const readAt = new Date().toISOString();

  for (const notification of await notifications.listByUser(user.id, NOTIFICATION_LIST_LIMIT)) {
    if (notification.readAt === null) await notifications.markRead(notification.id, readAt);
  }
}
