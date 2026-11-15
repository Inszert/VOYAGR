import type { Metadata } from 'next';
import { Button, StateScreen } from '@/components/ui';

/**
 * Offline fallback.
 *
 * Precached by the service worker and served when a navigation fails. It is
 * static by necessity - it has to render with no network at all - and so the
 * action is a plain link back to the page you were on, not a script.
 *
 * It shows no prices. A cached price with no timestamp is exactly the false
 * certainty the product specification warns against.
 */

export const metadata: Metadata = {
  title: 'Offline',
};

export default function OfflinePage() {
  return (
    <StateScreen
      kind="offline"
      title="You are offline"
      description="Prices change constantly, so none is shown from memory. Reconnect and the page loads with fresh figures."
      action={
        <Button asChild variant="secondary" size="lg">
          {/* A full navigation on purpose: client-side routing is what just failed. */}
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
          <a href="/">Try again</a>
        </Button>
      }
    />
  );
}
