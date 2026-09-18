'use client';

import { useEffect } from 'react';
import { Button, Card, CardDescription, CardHeader, CardTitle } from '@/components/ui';

/**
 * Route error boundary.
 *
 * Shows a generic message and never renders `error.message`: a server error
 * message can contain a provider response, a query or a connection detail. The
 * `digest` is safe to display and is what correlates this screen with the
 * server-side log entry.
 */
export default function RouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Client-side reporting hook. A real error tracker is wired in here.
    console.error('Unhandled route error', { digest: error.digest });
  }, [error]);

  return (
    <Card as="section" className="max-w-xl">
      <CardHeader>
        <CardTitle level={2}>Something went wrong</CardTitle>
        <CardDescription>
          This page could not be rendered. The error has been logged.
        </CardDescription>
      </CardHeader>

      <div className="flex flex-col gap-4">
        {error.digest ? (
          <p className="text-ink-muted text-sm">
            Reference:{' '}
            <code className="bg-surface-sunken rounded px-1.5 py-0.5 font-mono">
              {error.digest}
            </code>
          </p>
        ) : null}

        <div>
          <Button onClick={reset}>Try again</Button>
        </div>
      </div>
    </Card>
  );
}
