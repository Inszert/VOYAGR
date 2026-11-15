'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';

import { setConsentAction } from '@/app/actions/consent';
import { Button } from '@/components/ui';
import type { ConsentChoice } from '@/consent/cookie';

/**
 * The cookie choice.
 *
 * A region at the bottom of the viewport, not a dialog: it does not trap focus,
 * does not dim the page and does not block it. Two buttons of the same size and
 * weight - declining is exactly as easy as accepting, and neither is
 * pre-selected or pushed to a link.
 *
 * The server decides whether to render it (`initialChoice` is read from the
 * cookie in the layout), so a visitor who has chosen never sees it flash. The
 * footer's "Cookie settings" button reopens it through a window event, because
 * the two sit in different parts of the tree.
 *
 * **Why a reload on Accept.** The consent decides which third-party origin the
 * *document's* Content-Security-Policy allows, and a CSP belongs to the
 * document response: `router.refresh()` fetches a new render but cannot widen
 * the policy of the page already loaded, so the browser would block the very
 * script just allowed. A reload gets a fresh document under the matching policy.
 * Likewise a reload after withdrawing consent stops a script that is already
 * running. Declining when nothing was running only needs `router.refresh()` to
 * drop the banner.
 *
 * While open it publishes its height as `--consent-h` on the root element, so
 * the phone search bar (also pinned to the bottom) can lift itself clear
 * instead of being covered.
 */

export const COOKIE_SETTINGS_EVENT = 'voyagr:cookie-settings';

export interface ConsentBannerProps {
  /** What the visitor's cookie says right now; null when they have not chosen. */
  initialChoice: ConsentChoice | null;
}

export function ConsentBanner({ initialChoice }: ConsentBannerProps) {
  const router = useRouter();
  const ref = React.useRef<HTMLElement>(null);
  const [choice, setChoice] = React.useState<ConsentChoice | null>(initialChoice);
  const [reopened, setReopened] = React.useState(false);
  const [pending, setPending] = React.useState(false);
  const [failed, setFailed] = React.useState(false);

  React.useEffect(() => {
    const open = () => setReopened(true);
    window.addEventListener(COOKIE_SETTINGS_EVENT, open);
    return () => window.removeEventListener(COOKIE_SETTINGS_EVENT, open);
  }, []);

  const visible = choice === null || reopened;

  React.useEffect(() => {
    const root = document.documentElement;
    const element = ref.current;
    if (!visible || !element) {
      root.style.removeProperty('--consent-h');
      return;
    }

    const publish = () => root.style.setProperty('--consent-h', `${element.offsetHeight}px`);
    publish();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(publish);
    observer?.observe(element);

    return () => {
      observer?.disconnect();
      root.style.removeProperty('--consent-h');
    };
  }, [visible]);

  if (!visible) return null;

  async function choose(next: ConsentChoice) {
    if (pending) return;
    setPending(true);
    setFailed(false);

    try {
      await setConsentAction(next);
    } catch {
      setPending(false);
      setFailed(true);
      return;
    }

    const scriptMayBeRunning = choice === 'accepted';
    setChoice(next);
    setReopened(false);
    setPending(false);

    if (next === 'accepted' || scriptMayBeRunning) {
      window.location.reload();
    } else {
      router.refresh();
    }
  }

  return (
    <section
      ref={ref}
      role="region"
      aria-label="Cookies"
      className="bg-panel border-hairline fixed inset-x-0 bottom-0 z-40 border-t pb-[env(safe-area-inset-bottom)] shadow-[0_-8px_32px_rgb(0_0_0/0.35)]"
    >
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
        <p className="text-text text-sm leading-relaxed">
          We use one partner script (Travelpayouts) to track bookings made through our links. No ads
          profile is built by us.{' '}
          <a
            href="/privacy#cookies"
            className="text-accent-ink underline underline-offset-4 hover:no-underline"
          >
            Cookie details
          </a>
        </p>
        <div className="flex shrink-0 gap-3">
          <Button
            variant="secondary"
            size="md"
            className="flex-1 sm:flex-none"
            disabled={pending}
            onClick={() => void choose('declined')}
          >
            Decline
          </Button>
          <Button
            variant="secondary"
            size="md"
            className="flex-1 sm:flex-none"
            disabled={pending}
            onClick={() => void choose('accepted')}
          >
            Accept
          </Button>
        </div>
        {failed ? (
          <p role="alert" className="text-critical-ink text-sm sm:basis-full">
            Your choice could not be saved. Please try again.
          </p>
        ) : null}
      </div>
    </section>
  );
}

/** The footer's way back to the choice. */
export function CookieSettingsButton({ className }: { className?: string }) {
  return (
    <button
      type="button"
      className={className}
      onClick={() => window.dispatchEvent(new Event(COOKIE_SETTINGS_EVENT))}
    >
      Cookie settings
    </button>
  );
}
