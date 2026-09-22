import type { Metadata } from 'next';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui';

/**
 * Offline fallback.
 *
 * Precached by the service worker and served when a navigation fails. It is
 * static by necessity - it has to render with no network at all.
 *
 * It shows no prices. A cached price with no timestamp is exactly the false
 * certainty the product specification warns against.
 */

export const metadata: Metadata = {
  title: 'Offline',
};

export default function OfflinePage() {
  return (
    <Card as="section" className="max-w-xl">
      <CardHeader>
        <CardTitle level={2}>You are offline</CardTitle>
        <CardDescription>
          Voyagr needs a connection to check current prices. Saved trips and alerts will be waiting
          when you reconnect.
        </CardDescription>
      </CardHeader>

      <p className="text-ink-muted text-sm">
        Travel prices change constantly, so nothing priced is shown from cache. Reconnect and the
        page will load fresh figures.
      </p>
    </Card>
  );
}
