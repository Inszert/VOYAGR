import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { money } from '@/core/money';
import { buildProfile } from '@/core/trip/test-support';
import type { SearchOutcome } from '@/search/types';
import { EmptySearch } from './empty-search';

/**
 * A search that found no trip says which kind of nothing it was.
 */

const env = vi.hoisted(() => ({ partnerId: undefined as string | undefined }));

vi.mock('@/lib/env', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/env')>()),
  getEnv: () => ({ AVIASALES_PARTNER_ID: env.partnerId }),
}));

const profile = buildProfile({
  passengers: 1,
  minNights: 7,
  maxNights: 7,
  earliestDeparture: '2026-11-01',
  latestReturn: '2026-11-30',
});

/** The plan of a search that asked about one route and one pair of dates. */
const singleRoutePlan = {
  origins: ['VIE'],
  destinations: ['KZN'],
  dateWindows: [{ departureDate: '2026-11-23', returnDate: '2026-11-30', nights: 7 }],
};

const outcome = (
  overrides: Partial<SearchOutcome>,
  flightOffersFound: number,
  plan: Record<string, unknown> = singleRoutePlan,
): SearchOutcome =>
  ({
    results: [],
    nearMisses: [],
    overBudgetOnly: [],
    routeOffers: [],
    destinationSummaries: [],
    diagnostics: {
      plan,
      sources: [
        {
          part: 'flights',
          providerId: 'aviasales',
          displayName: 'Aviasales (Travelpayouts)',
          provenance: 'indicative',
        },
      ],
      issues: [],
      flightOffersFound,
    },
    ...overrides,
  }) as unknown as SearchOutcome;

const linkWith = (changes: Readonly<Record<string, string | null>>) =>
  `/explore?${new URLSearchParams(
    Object.entries(changes).filter((entry): entry is [string, string] => entry[1] !== null),
  ).toString()}`;

describe('EmptySearch', () => {
  it('lists the stay lengths the vendor had, each searching exactly those dates', () => {
    render(
      <EmptySearch
        profile={profile}
        linkWith={linkWith}
        outcome={outcome(
          {
            otherStayLengths: [
              {
                departureDate: '2026-11-23',
                returnDate: '2026-11-29',
                nights: 6,
                price: money(48800, 'EUR'),
                destination: 'KZN',
              },
            ],
          },
          2,
        )}
      />,
    );

    expect(screen.getByText('No 7-night trip in those dates')).toBeInTheDocument();
    const list = screen.getByRole('list', { name: 'Other stay lengths with fares' });
    const link = within(list).getByRole('link');
    expect(link).toHaveTextContent('6 nights');
    expect(link).toHaveTextContent('€488');
    const href = new URL(link.getAttribute('href')!, 'http://x').searchParams;
    expect(href.get('flexibility')).toBe('exact');
    expect(href.get('departureDate')).toBe('2026-11-23');
    expect(href.get('returnDate')).toBe('2026-11-29');
  });

  it('says plainly when the vendor returned nothing, and offers dates either side', () => {
    render(<EmptySearch profile={profile} linkWith={linkWith} outcome={outcome({}, 0)} />);

    expect(screen.getByText('No fares came back for these dates')).toBeInTheDocument();
    expect(screen.getByText(/Aviasales \(Travelpayouts\) returned no price/)).toBeInTheDocument();

    const nearby = new URL(
      screen.getByRole('link', { name: 'Search 7 days either side' }).getAttribute('href')!,
      'http://x',
    ).searchParams;
    // A valid choice the form accepts, not the `flexible` it used to send.
    expect(nearby.get('flexibility')).toBe('custom');
    expect(nearby.get('earliestDeparture')).toBe('2026-10-25');
    expect(nearby.get('latestReturn')).toBe('2026-12-07');
    expect(nearby.get('minNights')).toBe('7');
  });

  describe('live Aviasales link on a search with no fares', () => {
    const liveLink = () =>
      screen.queryByRole('link', { name: 'Search live prices on Aviasales (opens in a new tab)' });

    it('links to a live search for the same route and dates, in a new tab, as sponsored', () => {
      env.partnerId = undefined;
      render(<EmptySearch profile={profile} linkWith={linkWith} outcome={outcome({}, 0)} />);

      const link = liveLink();
      expect(link).toBeInTheDocument();
      expect(link).toHaveAttribute('target', '_blank');
      expect(link).toHaveAttribute('rel', 'noopener noreferrer sponsored');
      // VIE out 23 Nov, back 30 Nov, one passenger.
      expect(link).toHaveAttribute('href', 'https://www.aviasales.com/search/VIE2311KZN30111');
    });

    it('uses the passenger count of the search', () => {
      env.partnerId = undefined;
      render(
        <EmptySearch
          profile={{ ...profile, passengers: 3 }}
          linkWith={linkWith}
          outcome={outcome({}, 0)}
        />,
      );

      expect(liveLink()).toHaveAttribute('href', 'https://www.aviasales.com/search/VIE2311KZN30113');
    });

    it('carries the configured partner marker', () => {
      env.partnerId = '780591';
      render(<EmptySearch profile={profile} linkWith={linkWith} outcome={outcome({}, 0)} />);

      expect(liveLink()).toHaveAttribute(
        'href',
        'https://www.aviasales.com/search/VIE2311KZN30111?marker=780591',
      );
      env.partnerId = undefined;
    });

    it('is not shown when the search covered more than one date window', () => {
      env.partnerId = undefined;
      render(
        <EmptySearch
          profile={profile}
          linkWith={linkWith}
          outcome={outcome({}, 0, {
            ...singleRoutePlan,
            dateWindows: [
              { departureDate: '2026-11-23', returnDate: '2026-11-30', nights: 7 },
              { departureDate: '2026-11-24', returnDate: '2026-12-01', nights: 7 },
            ],
          })}
        />,
      );

      expect(screen.getByText('No fares came back for these dates')).toBeInTheDocument();
      expect(liveLink()).not.toBeInTheDocument();
    });

    it('is not shown when the search covered more than one destination', () => {
      env.partnerId = undefined;
      render(
        <EmptySearch
          profile={profile}
          linkWith={linkWith}
          outcome={outcome({}, 0, { ...singleRoutePlan, destinations: ['KZN', 'LED'] })}
        />,
      );

      expect(liveLink()).not.toBeInTheDocument();
    });

    it('is not shown when the search had more than one origin', () => {
      env.partnerId = undefined;
      render(
        <EmptySearch
          profile={{ ...profile, origins: ['VIE', 'BTS'] }}
          linkWith={linkWith}
          outcome={outcome({}, 0)}
        />,
      );

      expect(liveLink()).not.toBeInTheDocument();
    });
  });
});
