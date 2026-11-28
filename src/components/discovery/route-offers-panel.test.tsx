import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { RouteOffersPanel } from './route-offers-panel';

const props = {
  origin: 'VIE',
  destination: 'BCN',
  departureDate: '2027-02-10',
  returnDate: '2027-02-14',
};

const leg = {
  departsAt: '2027-02-10T07:00:00',
  arrivesAt: '2027-02-10T09:10:00',
  durationMinutes: 130,
  stops: 0,
  flights: ['FR 123'],
};

const json = (body: unknown, status = 200) =>
  Promise.resolve(new Response(JSON.stringify(body), { status }));

describe('RouteOffersPanel', () => {
  it('runs the read path once, shows a skeleton, then price, link and age', async () => {
    const fetcher = vi.fn((..._args: Parameters<typeof fetch>) =>
      json({
        status: 'fresh',
        label: 'checked 3 h ago',
        observedAt: '2026-11-28T07:00:00.000Z',
        refreshFailed: false,
        offers: [
          {
            id: 'o1',
            price: 'EUR 123.45',
            bookingUrl: 'https://www.kiwi.com/deep?x=1',
            outbound: leg,
            inbound: leg,
          },
        ],
      }),
    );
    render(<RouteOffersPanel {...props} fetcher={fetcher} />);

    expect(screen.getByRole('status', { name: 'Checking flights' })).toBeInTheDocument();
    expect(await screen.findByText('checked 3 h ago')).toBeInTheDocument();
    expect(screen.getByText('EUR 123.45')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /book on kiwi/i })).toHaveAttribute(
      'href',
      'https://www.kiwi.com/deep?x=1',
    );
    expect(screen.getAllByText(/10 Feb 2027, 07:00, 2 h 10 min, direct/)).toHaveLength(2);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(String(fetcher.mock.calls[0]?.[0])).toContain('/api/route-offers?');
  });

  it('says plainly that nothing could be checked when the call failed and nothing is stored', async () => {
    const fetcher = vi.fn((..._args: Parameters<typeof fetch>) =>
      json({
        status: 'no_data',
        label: 'no data yet',
        observedAt: null,
        refreshFailed: true,
        offers: [],
      }),
    );
    render(<RouteOffersPanel {...props} fetcher={fetcher} />);
    expect(await screen.findByText(/nothing is saved for this route yet/i)).toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('shows the same honest message when the request itself fails', async () => {
    const fetcher = vi.fn((..._args: Parameters<typeof fetch>) => json({}, 500));
    render(<RouteOffersPanel {...props} fetcher={fetcher} />);
    expect(await screen.findByText(/nothing is saved for this route yet/i)).toBeInTheDocument();
  });

  it('cancels the request in flight when the user clicks away', async () => {
    let signal: AbortSignal | undefined;
    const fetcher = vi.fn((_url: Parameters<typeof fetch>[0], init?: RequestInit) => {
      signal = init?.signal ?? undefined;
      return new Promise<Response>(() => undefined);
    });
    const { unmount } = render(<RouteOffersPanel {...props} fetcher={fetcher} />);
    await waitFor(() => expect(signal).toBeDefined());
    unmount();
    expect(signal?.aborted).toBe(true);
  });
});
