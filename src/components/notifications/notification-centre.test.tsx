import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { NotificationFeed } from '@/notifications/in-app';
import { NotificationCentre } from './notification-centre';

const markOne = vi.fn(async (_id: string) => undefined);
const markAll = vi.fn(async () => undefined);

vi.mock('@/app/actions/notifications', () => ({
  markNotificationReadAction: (id: string) => markOne(id),
  markAllNotificationsReadAction: () => markAll(),
}));

const item = (id: string, read = false) => ({
  id,
  severity: 'important' as const,
  title: `Drop ${id}`,
  body: `Body ${id}`,
  url: `/?trip=${id}`,
  createdAt: '2026-11-14T10:00:00.000Z',
  read,
});

let feed: NotificationFeed;

beforeEach(() => {
  feed = { unread: 0, items: [] };
  markOne.mockClear();
  markAll.mockClear();
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json(feed)),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('NotificationCentre', () => {
  it('names the button with the unread count, not just a number', async () => {
    feed = { unread: 2, items: [item('a'), item('b')] };
    render(<NotificationCentre />);

    expect(await screen.findByRole('button', { name: 'Notifications, 2 unread' })).toBeVisible();
  });

  it('has a plain name when nothing is unread', async () => {
    render(<NotificationCentre />);

    expect(await screen.findByRole('button', { name: 'Notifications' })).toBeVisible();
  });

  it('shows an empty state with an explanation', async () => {
    render(<NotificationCentre />);

    await userEvent.click(await screen.findByRole('button', { name: 'Notifications' }));

    expect(await screen.findByText(/Nothing yet/)).toBeVisible();
  });

  it('lists alerts, marks one as read and drops the count', async () => {
    feed = { unread: 2, items: [item('a'), item('b', false)] };
    render(<NotificationCentre />);

    await userEvent.click(await screen.findByRole('button', { name: 'Notifications, 2 unread' }));
    await userEvent.click(await screen.findByRole('button', { name: /Mark as read: Drop a/ }));

    expect(markOne).toHaveBeenCalledWith('a');
    expect(await screen.findByRole('button', { name: 'Notifications, 1 unread' })).toBeVisible();
  });

  it('marks everything as read in one step', async () => {
    feed = { unread: 2, items: [item('a'), item('b')] };
    render(<NotificationCentre />);

    await userEvent.click(await screen.findByRole('button', { name: 'Notifications, 2 unread' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Mark all as read' }));

    expect(markAll).toHaveBeenCalledOnce();
    expect(await screen.findByRole('button', { name: 'Notifications' })).toBeVisible();
  });

  it('does not offer to mark all as read when nothing is unread', async () => {
    feed = { unread: 0, items: [item('a', true)] };
    render(<NotificationCentre />);

    await userEvent.click(await screen.findByRole('button', { name: 'Notifications' }));

    expect(await screen.findByRole('button', { name: 'Mark all as read' })).toBeDisabled();
  });

  it('does not toast for what was already there on first load', async () => {
    feed = { unread: 1, items: [item('a')] };
    render(<NotificationCentre />);

    await screen.findByRole('button', { name: 'Notifications, 1 unread' });

    expect(screen.queryByText('Drop a')).not.toBeInTheDocument();
  });

  it('toasts an alert that arrives while the page is open', async () => {
    feed = { unread: 1, items: [item('a')] };
    render(<NotificationCentre />);
    await screen.findByRole('button', { name: 'Notifications, 1 unread' });

    feed = { unread: 2, items: [item('b'), item('a')] };
    await act(async () => {
      window.dispatchEvent(new Event('focus'));
    });

    await waitFor(() => expect(screen.getByText('Drop b')).toBeInTheDocument());
    expect(screen.getByRole('link', { name: 'View trip' })).toHaveAttribute('href', '/?trip=b');
  });
});
