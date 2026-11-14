'use client';

import * as React from 'react';
import { Icon, Popover, PopoverPanel, PopoverTrigger, Toast } from '@/components/ui';
import {
  markAllNotificationsReadAction,
  markNotificationReadAction,
} from '@/app/actions/notifications';
import type { NotificationFeed, NotificationView } from '@/notifications/in-app';

/**
 * The bell: every alert Voyagr has raised for you, whether or not a push
 * reached you.
 *
 * The alerts are rows the watch pipeline writes when it detects a deal, so this
 * is a window onto what was decided, not a second opinion. It polls rather
 * than holding a connection open - a price alert is not urgent to the second,
 * and a minute is the honest cadence for something the worker produces every
 * few hours.
 *
 * A toast appears only for an alert that arrives *while the page is open*. The
 * first load records what is already there without announcing it, or every
 * visit would greet you with the same old alert.
 */

const POLL_MS = 60_000;

const FORMAT = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});

async function fetchFeed(): Promise<NotificationFeed | null> {
  try {
    const response = await fetch('/api/notifications', { cache: 'no-store' });
    return response.ok ? ((await response.json()) as NotificationFeed) : null;
  } catch {
    // Offline or a blip: keep what is shown. The next poll tries again.
    return null;
  }
}

export function NotificationCentre() {
  const [feed, setFeed] = React.useState<NotificationFeed>({ unread: 0, items: [] });
  const [loaded, setLoaded] = React.useState(false);
  const [open, setOpen] = React.useState(false);
  const [toast, setToast] = React.useState<NotificationView | null>(null);
  const [toastOpen, setToastOpen] = React.useState(false);
  const seen = React.useRef<Set<string> | null>(null);

  const refresh = React.useCallback(async () => {
    const next = await fetchFeed();
    if (!next) return;

    if (seen.current === null) {
      seen.current = new Set(next.items.map((item) => item.id));
    } else {
      const fresh = next.items.find((item) => !item.read && !seen.current!.has(item.id));
      for (const item of next.items) seen.current.add(item.id);

      if (fresh) {
        setToast(fresh);
        setToastOpen(true);
      }
    }

    setFeed(next);
    setLoaded(true);
  }, []);

  React.useEffect(() => {
    void refresh();

    const timer = setInterval(() => void refresh(), POLL_MS);
    const onFocus = () => void refresh();
    window.addEventListener('focus', onFocus);

    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', onFocus);
    };
  }, [refresh]);

  // Optimistic: the count drops as you click; the action catches the server up.
  const markRead = (id: string) => {
    setFeed((current) => {
      const items = current.items.map((item) => (item.id === id ? { ...item, read: true } : item));
      return { items, unread: items.filter((item) => !item.read).length };
    });
    void markNotificationReadAction(id);
  };

  const markAllRead = () => {
    setFeed((current) => ({
      items: current.items.map((item) => ({ ...item, read: true })),
      unread: 0,
    }));
    void markAllNotificationsReadAction();
  };

  const label = feed.unread > 0 ? `Notifications, ${feed.unread} unread` : 'Notifications';

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label={label}
            className="voyagr-panel text-text ease-standard duration-quick relative inline-flex size-11 items-center justify-center rounded-(--radius-pill) transition-colors hover:border-(--color-stage-accent)"
          >
            <Icon name="bell" size={1.15} />
            {feed.unread > 0 ? (
              <span
                aria-hidden="true"
                className="bg-stage-accent text-stage-ink absolute -top-1 -right-1 inline-flex min-w-5 items-center justify-center rounded-full px-1 text-[11px] leading-5 font-semibold tabular-nums"
              >
                {feed.unread > 9 ? '9+' : feed.unread}
              </span>
            ) : null}
          </button>
        </PopoverTrigger>

        <PopoverPanel align="end" className="w-[min(24rem,calc(100vw-1.5rem))] p-0">
          <div className="border-hairline flex items-center justify-between gap-3 border-b px-4 py-3">
            <h2 className="text-text text-base font-semibold">Notifications</h2>
            <button
              type="button"
              onClick={markAllRead}
              disabled={feed.unread === 0}
              className="text-accent-ink min-h-[44px] text-sm underline underline-offset-4 disabled:text-(--color-dim) disabled:no-underline"
            >
              Mark all as read
            </button>
          </div>

          {loaded && feed.items.length === 0 ? (
            <p className="text-muted px-4 py-6 text-sm">
              Nothing yet. When a trip you are watching gets cheaper, the alert shows up here.
            </p>
          ) : (
            <ul className="max-h-[min(28rem,70vh)] overflow-y-auto">
              {feed.items.map((item) => (
                <li key={item.id} className="border-hairline border-b px-4 py-3 last:border-b-0">
                  <p className="text-text text-sm font-semibold">
                    {item.read ? null : <span className="sr-only">Unread: </span>}
                    {item.title}
                  </p>
                  <p className="text-muted mt-1 text-sm">{item.body}</p>
                  <div className="mt-2 flex flex-wrap items-center gap-x-4 text-sm">
                    <time dateTime={item.createdAt} className="text-dim">
                      {FORMAT.format(new Date(item.createdAt))}
                    </time>
                    {item.url ? (
                      <a
                        href={item.url}
                        onClick={() => {
                          if (!item.read) markRead(item.id);
                        }}
                        className="text-accent-ink inline-flex min-h-[44px] items-center underline underline-offset-4"
                      >
                        View trip
                      </a>
                    ) : null}
                    {item.read ? null : (
                      <button
                        type="button"
                        onClick={() => markRead(item.id)}
                        className="text-muted hover:text-text min-h-[44px] underline underline-offset-4"
                      >
                        Mark as read
                        <span className="sr-only">: {item.title}</span>
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </PopoverPanel>
      </Popover>

      {toast ? (
        <Toast
          open={toastOpen}
          onOpenChange={setToastOpen}
          title={toast.title}
          description={toast.body}
          {...(toast.url ? { action: { label: 'View trip', href: toast.url } } : {})}
        />
      ) : null}
    </>
  );
}
