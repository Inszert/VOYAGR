'use client';

import { useEffect } from 'react';
import { Button, Container, StateScreen } from '@/components/ui';

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
    <Container size="wide" className="py-10 lg:py-16">
      <StateScreen
        kind="error"
        title="Something went wrong"
        description="This page could not be shown. The error has been logged, and trying again often works."
        action={
          <Button size="lg" onClick={reset}>
            Try again
          </Button>
        }
        footnote={
          error.digest ? (
            <>
              Reference: <code className="font-mono">{error.digest}</code>
            </>
          ) : null
        }
      />
    </Container>
  );
}
