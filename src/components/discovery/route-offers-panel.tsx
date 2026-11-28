'use client';

import * as React from 'react';
import { Skeleton } from '@/components/ui';
import type { RouteOffersDto } from '@/app/api/route-offers/handler';

/**
 * What opens when a route or destination is clicked: the real offers for it.
 *
 * Mounting this IS the click: it runs the 12-hour read path once (through `/api/route-offers`),
 * shows a skeleton while the call runs, then the offers with the vendor's own booking link and
 * how old the data is. Unmounting (the user clicked away) cancels the request. When the call
 * failed and nothing was ever stored it says that, and does not draw an empty list as if it
 * were an answer.
 *
 * Prices are the server's strings. This component does no arithmetic.
 */

export interface RouteOffersPanelProps {
  origin: string;
  destination: string;
  departureDate: string;
  returnDate: string;
  adults?: number;
  currency?: string;
  fetcher?: typeof fetch;
}

type State = { phase: 'loading' } | { phase: 'done'; data: RouteOffersDto } | { phase: 'failed' };

function duration(minutes: number): string {
  return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, '0')} min`;
}

export function RouteOffersPanel({
  origin,
  destination,
  departureDate,
  returnDate,
  adults = 1,
  currency = 'EUR',
  fetcher,
}: RouteOffersPanelProps) {
  const [state, setState] = React.useState<State>({ phase: 'loading' });

  React.useEffect(() => {
    const controller = new AbortController();
    const query = new URLSearchParams({
      origin,
      destination,
      departureDate,
      returnDate,
      adults: String(adults),
      currency,
    });
    const run = fetcher ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
    setState({ phase: 'loading' });
    run(`/api/route-offers?${query}`, { signal: controller.signal })
      .then((response) => (response.ok ? (response.json() as Promise<RouteOffersDto>) : null))
      .then((data) => {
        if (controller.signal.aborted) return;
        setState(data ? { phase: 'done', data } : { phase: 'failed' });
      })
      .catch(() => {
        if (!controller.signal.aborted) setState({ phase: 'failed' });
      });
    // Clicking away cancels the call in flight.
    return () => controller.abort();
  }, [origin, destination, departureDate, returnDate, adults, currency, fetcher]);

  const title = `${origin} to ${destination}`;

  return (
    <section aria-label={`Flights ${title}`} aria-busy={state.phase === 'loading'}>
      <h2 className="text-lg font-semibold">{title}</h2>

      {state.phase === 'loading' ? (
        <div className="mt-3 space-y-2">
          <Skeleton label="Checking flights" className="h-16" />
          <Skeleton className="h-16" />
        </div>
      ) : null}

      {state.phase === 'failed' || (state.phase === 'done' && state.data.status === 'no_data') ? (
        <p role="status" className="mt-3">
          We could not check these flights just now, and nothing is saved for this route yet. Try
          again in a moment.
        </p>
      ) : null}

      {state.phase === 'done' && state.data.status !== 'no_data' ? (
        <>
          <p className="text-ink-muted mt-1 text-sm">
            {state.data.label}
            {state.data.refreshFailed ? ' (we could not refresh it just now)' : ''}
          </p>
          {state.data.offers.length === 0 ? (
            <p className="mt-3">No flights were found for these dates.</p>
          ) : (
            <ul className="mt-3 space-y-3">
              {state.data.offers.map((offer) => (
                <li key={offer.id} className="border-border rounded-(--radius-control) border p-3">
                  <p className="text-base font-semibold">{offer.price}</p>
                  <p className="text-sm">
                    Out {offer.outbound.departsAt.slice(0, 16).replace('T', ' ')},{' '}
                    {duration(offer.outbound.durationMinutes)}, {offer.outbound.stops} stops (
                    {offer.outbound.flights.join(', ')})
                  </p>
                  <p className="text-sm">
                    Back {offer.inbound.departsAt.slice(0, 16).replace('T', ' ')},{' '}
                    {duration(offer.inbound.durationMinutes)}, {offer.inbound.stops} stops (
                    {offer.inbound.flights.join(', ')})
                  </p>
                  {offer.bookingUrl ? (
                    <a
                      className="mt-1 inline-block underline"
                      href={offer.bookingUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Book on Kiwi.com
                    </a>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </>
      ) : null}
    </section>
  );
}
