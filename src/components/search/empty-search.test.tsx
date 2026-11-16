import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { money } from '@/core/money';
import { buildProfile } from '@/core/trip/test-support';
import type { SearchOutcome } from '@/search/types';
import { EmptySearch } from './empty-search';

/**
 * A search that found no trip says which kind of nothing it was.
 */

const profile = buildProfile({
  passengers: 1,
  minNights: 7,
  maxNights: 7,
  earliestDeparture: '2026-11-01',
  latestReturn: '2026-11-30',
});

const outcome = (overrides: Partial<SearchOutcome>, flightOffersFound: number): SearchOutcome =>
  ({
    results: [],
    nearMisses: [],
    overBudgetOnly: [],
    routeOffers: [],
    destinationSummaries: [],
    diagnostics: {
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
});
