import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { buildProfile } from '@/core/trip/test-support';
import { DEFAULT_SEARCH_LIMITS } from '@/search/types';
import { NO_FILTERS } from '@/search/filters';
import { summariseDestinations } from '@/search/destinations';
import { buildRankedTrip } from './test-support';
import { SearchResults } from './search-results';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));

/**
 * The controls that narrow and re-aim a list of trips are on the page when
 * there are trips, not behind a disclosure, and each trip says where it leaves from.
 */
function renderResults() {
  const first = buildRankedTrip({ id: 'trip-vie' });
  const second = buildRankedTrip({ id: 'trip-bts', origin: 'BTS' });
  const third = buildRankedTrip({ id: 'trip-bts-2', origin: 'BTS' });
  const fourth = buildRankedTrip({ id: 'trip-vie-2' });
  const trips = [first, fourth, second, third];

  return render(
    <SearchResults
      profile={buildProfile({ origins: ['VIE'] })}
      filters={NO_FILTERS}
      searchValues={{ origins: 'VIE' }}
      outcome={{
        results: trips,
        nearMisses: [],
        overBudgetOnly: [],
        routeOffers: [],
        destinationSummaries: summariseDestinations(trips),
        diagnostics: {
          provenance: 'live',
          sources: [{ part: 'flights', providerId: 'x', displayName: 'X Air', provenance: 'live' }],
          quoteFreshness: { fresh: 3, stale: 0, unknown: 0 },
          plan: {
            origins: ['VIE'],
            destinations: ['AYT'],
            dateWindows: [{ departureDate: '2026-06-10', returnDate: '2026-06-15', nights: 5 }],
            dateWindowsAvailable: 40,
            originsRequested: 1,
            destinationsRequested: 1,
            currency: 'EUR',
            passengers: 2,
            earliestDate: '2026-06-10',
            latestDate: '2026-06-15',
            limits: DEFAULT_SEARCH_LIMITS,
          },
          providerCalls: 12,
          peakProviderConcurrency: 6,
          issues: [],
          degraded: false,
          candidatesAssembled: 3,
          candidatesEvaluated: 3,
          eligibleCount: 3,
          ineligibleCount: 0,
          durationMs: 0,
        },
      }}
    />,
  );
}

describe('results controls', () => {
  it('shows the sort and the filters without opening anything', () => {
    renderResults();
    expect(screen.getByLabelText('Sort by')).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Narrow these results' })).toBeVisible();
    expect(screen.getByRole('checkbox', { name: 'Direct only' })).toBeInTheDocument();
  });

  it('shows and hides the filters from a button beside the sort', () => {
    renderResults();
    const button = screen.getByRole('button', { name: 'Filters' });
    const panelId = button.getAttribute('aria-controls')!;
    expect(panelId).toBeTruthy();
    expect(button).toHaveAttribute('aria-expanded', 'true');
    expect(document.getElementById(panelId)).toBeVisible();

    fireEvent.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(document.getElementById(panelId)).not.toBeVisible();
    expect(screen.getByLabelText('Sort by')).toBeVisible();

    fireEvent.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('heading', { name: 'Narrow these results' })).toBeVisible();
  });

  it('offers nearby airports as a visible control that adds one to the origins', () => {
    renderResults();
    expect(screen.getByRole('heading', { name: 'Also fly from nearby airports' })).toBeVisible();
    const link = screen.getAllByRole('link', { name: /add to the search/ })[0]!;
    expect(link).toBeVisible();
    expect(link.getAttribute('href') ?? '').toMatch(/origins=VIE%2C+\+\w{3}/);
  });

  it('says where a trip leaves from, and which origin is cheapest, in words', () => {
    renderResults();
    expect(screen.getAllByText(/from VIE/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/from BTS/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/^Cheapest from VIE$/).length).toBeGreaterThan(0);
  });
});
