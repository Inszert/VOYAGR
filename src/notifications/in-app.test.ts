import { beforeEach, describe, expect, it } from 'vitest';
import { createMemoryRepositories } from '@/db/memory';
import type { Repositories } from '@/db/repository';
import { loadNotificationFeed, NOTIFICATION_LIST_LIMIT } from './in-app';

let repositories: Repositories;

const alert = (userId: string, title: string, readAt: string | null = null) =>
  repositories.notifications.create({
    userId,
    watchId: null,
    severity: 'important',
    title,
    body: 'body',
    url: '/?origins=VIE',
    readAt,
    deliveredAt: null,
  });

beforeEach(() => {
  repositories = createMemoryRepositories();
});

describe('loadNotificationFeed', () => {
  it('is empty for a user with no alerts', async () => {
    expect(await loadNotificationFeed(repositories, 'u1')).toEqual({ unread: 0, items: [] });
  });

  it('counts only unread alerts, and only the user own', async () => {
    await alert('u1', 'unread');
    await alert('u1', 'read', '2026-11-14T10:00:00.000Z');
    await alert('u2', 'someone else');

    const feed = await loadNotificationFeed(repositories, 'u1');

    expect(feed.unread).toBe(1);
    expect(feed.items.map((item) => item.title).sort()).toEqual(['read', 'unread']);
    expect(feed.items.find((item) => item.title === 'read')?.read).toBe(true);
  });

  it('never lists more than the limit, so the count and the list agree', async () => {
    for (let i = 0; i < NOTIFICATION_LIST_LIMIT + 5; i += 1) await alert('u1', `alert ${i}`);

    const feed = await loadNotificationFeed(repositories, 'u1');

    expect(feed.items).toHaveLength(NOTIFICATION_LIST_LIMIT);
    expect(feed.unread).toBe(NOTIFICATION_LIST_LIMIT);
  });
});

describe('appRelativeUrl', () => {
  it('keeps a path on this site', async () => {
    const { appRelativeUrl } = await import('./in-app');
    expect(appRelativeUrl('/?origins=VIE')).toBe('/?origins=VIE');
    expect(appRelativeUrl('/watches')).toBe('/watches');
    expect(appRelativeUrl(null)).toBeNull();
  });

  it.each([
    'javascript:alert(1)',
    'https://evil.example/',
    '//evil.example/',
    `/${String.fromCharCode(92)}evil.example`,
    'data:text/html,x',
    `/ok${String.fromCharCode(10)}Set-Cookie: x`,
    '',
  ])('drops %j', async (value) => {
    const { appRelativeUrl } = await import('./in-app');
    expect(appRelativeUrl(value)).toBeNull();
  });
});
