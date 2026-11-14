import { getCurrentUser } from '@/auth/current-user';
import { getRepositories } from '@/db';
import { loadNotificationFeed } from '@/notifications/in-app';

/**
 * The signed-in user's alerts, for the bell in the header.
 *
 * A read-only GET, so it needs no CSRF defence; marking as read is a Server
 * Action. Never cached: an unread count that is a minute stale after the user
 * has read everything is a bell that lies.
 */
export async function GET(): Promise<Response> {
  const user = await getCurrentUser();

  if (!user) {
    return Response.json({ error: 'Sign in to see your notifications.' }, { status: 401 });
  }

  const feed = await loadNotificationFeed(getRepositories(), user.id);

  return Response.json(feed, { headers: { 'Cache-Control': 'no-store' } });
}
