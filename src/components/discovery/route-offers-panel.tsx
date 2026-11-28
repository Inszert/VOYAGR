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

/** "2027-03-04T07:15:00" -> "4 Mar 2027, 07:15". Reads the string; never builds a Date. */
function when(local: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}:\d{2})/.exec(local);
  if (!match) return local;
  const months = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ];
  return `${Number(match[3])} ${months[Number(match[2]) - 1] ?? match[2]} ${match[1]}, ${match[4]}`;
}

function stopsLabel(stops: number): string {
  return stops === 0 ? 'direct' : stops === 1 ? '1 stop' : `${stops} stops`;
}

function Leg({ label, leg }: { label: string; leg: RouteOffersDto['offers'][number]['outbound'] }) {
  return (
    <div className="grid grid-cols-[3rem_1fr] gap-x-2 text-sm">
      <dt className="text-ink-muted">{label}</dt>
      <dd>
        {when(leg.departsAt)}, {duration(leg.durationMinutes)}, {stopsLabel(leg.stops)}
        <span className="text-ink-muted block text-xs">{leg.flights.join(', ')}</span>
      </dd>
    </div>
  );
}

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
  // The answer is tagged with the request it belongs to. Any other request (or fetcher) is
  // still loading, so a change of inputs shows the skeleton without a synchronous setState.
  const [answer, setAnswer] = React.useState<{
    params: string;
    fetcher: typeof fetch | undefined;
    state: State;
  } | null>(null);
  const params = [origin, destination, departureDate, returnDate, String(adults), currency].join(
    '\u0000',
  );
  const state: State =
    answer && answer.params === params && answer.fetcher === fetcher
      ? answer.state
      : { phase: 'loading' };

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
    run(`/api/route-offers?${query}`, { signal: controller.signal })
      .then((response) => (response.ok ? (response.json() as Promise<RouteOffersDto>) : null))
      .then((data) => {
        if (controller.signal.aborted) return;
        setAnswer({
          params,
          fetcher,
          state: data ? { phase: 'done', data } : { phase: 'failed' },
        });
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setAnswer({ params, fetcher, state: { phase: 'failed' } });
        }
      });
    // Clicking away cancels the call in flight.
    return () => controller.abort();
  }, [origin, destination, departureDate, returnDate, adults, currency, fetcher, params]);

  const title = `${origin} to ${destination}`;

  return (
    <section aria-label={`Flights ${title}`} aria-busy={state.phase === 'loading'}>
      <h2 className="text-lg font-semibold">{title}</h2>

      {state.phase === 'loading' ? (
        <div className="mt-3 space-y-2">
          <Skeleton label="Checking flights" className="h-28" />
          <Skeleton className="h-28" />
        </div>
      ) : null}

      {state.phase === 'failed' || (state.phase === 'done' && state.data.status === 'no_data') ? (
        <p
          role="status"
          className="border-border bg-surface-sunken text-ink mt-3 rounded-(--radius-control) border p-3 text-sm"
        >
          We could not check these flights just now, and nothing is saved for this route yet. Try
          again in a moment.
        </p>
      ) : null}

      {state.phase === 'done' && state.data.status !== 'no_data' ? (
        <>
          <p className="text-ink-muted mt-1 text-sm">
            {state.data.label}
            {state.data.refreshFailed ? (
              <span className="text-caution-ink"> (we could not refresh it just now)</span>
            ) : null}
          </p>
          {state.data.offers.length === 0 ? (
            <p className="text-ink-muted mt-3 text-sm">No flights were found for these dates.</p>
          ) : (
            <ul className="mt-3 space-y-2">
              {state.data.offers.map((offer) => (
                <li
                  key={offer.id}
                  className="border-border bg-surface-raised rounded-(--radius-control) border p-3"
                >
                  <p className="text-lg leading-tight font-semibold tabular-nums">{offer.price}</p>
                  <dl className="mt-2 space-y-1.5">
                    <Leg label="Out" leg={offer.outbound} />
                    <Leg label="Back" leg={offer.inbound} />
                  </dl>
                  {offer.bookingUrl ? (
                    <a
                      className="text-brand-ink hover:text-ink mt-1 inline-flex min-h-11 items-center underline underline-offset-4"
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
