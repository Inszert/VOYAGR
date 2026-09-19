import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { buildFlightOffer, buildHotelOffer, buildTransferOffer } from '@/core/trip/test-support';
import { format, money } from '@/core/money';
import { buildProfile } from '@/core/trip/test-support';
import { CostBreakdown } from './cost-breakdown';
import { ScoreExplanation } from './score-explanation';
import { SearchForm } from './search-form';
import { TripCard } from './trip-card';
import { WarningList } from './warning-list';
import { DEFAULT_SEARCH_LIMITS } from '@/search/types';
import { buildRankedTrip } from './test-support';

/**
 * Search UI tests.
 *
 * Assertions are on roles, accessible names and text a user can actually read.
 * The rules being defended are the product's, not the markup's: an estimate
 * must not look like a quote, an excluded cost must not disappear, a warning
 * must be visible without being hunted for, and a booking link must be safe.
 */

/**
 * A complete diagnostics object.
 *
 * Built in full rather than stubbed, because `SearchResults` reads several
 * fields and a partial stub fails on whichever one the test did not think of.
 */
function buildDiagnostics(overrides: Record<string, unknown> = {}) {
  return {
    provenance: 'live',
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
    candidatesAssembled: 212,
    candidatesEvaluated: 212,
    eligibleCount: 192,
    ineligibleCount: 20,
    durationMs: 0,
    ...overrides,
  } as never;
}

describe('CostBreakdown', () => {
  it('shows every counted line with what is known about it', () => {
    const trip = buildRankedTrip();
    render(<CostBreakdown cost={trip.cost} passengers={2} nights={5} />);

    const table = screen.getByRole('table');
    expect(within(table).getByText(/Flights VIE to AYT/)).toBeInTheDocument();
    expect(within(table).getByText(/Hotel Marina/)).toBeInTheDocument();
    expect(within(table).getAllByText('Quoted').length).toBeGreaterThan(0);
  });

  it('labels an estimate as an estimate, in words rather than by colour', () => {
    const trip = buildRankedTrip({
      hotel: buildHotelOffer({ excludedFees: money(4000, 'EUR') }),
    });

    render(<CostBreakdown cost={trip.cost} passengers={2} nights={5} />);

    expect(screen.getByText('Estimated')).toBeInTheDocument();
    // The screen-reader prefix means the word is not the only thing carrying it.
    expect(screen.getAllByText('Confidence:').length).toBeGreaterThan(0);
  });

  it('surfaces an excluded cost instead of dropping it', () => {
    // No transfer priced means the trip really costs more than the total shown.
    const trip = buildRankedTrip({ transfer: null });

    render(<CostBreakdown cost={trip.cost} passengers={2} nights={5} />);

    expect(screen.getByRole('heading', { name: 'Not counted in this total' })).toBeInTheDocument();
    expect(screen.getByText(/The trip will cost more than the figure above/)).toBeInTheDocument();
  });

  it('separates what was quoted from what we estimated', () => {
    const trip = buildRankedTrip();
    render(<CostBreakdown cost={trip.cost} passengers={2} nights={5} />);

    expect(screen.getByText('Of which quoted by a provider')).toBeInTheDocument();
    expect(screen.getByText('Of which our own estimate')).toBeInTheDocument();
  });
});

describe('WarningList', () => {
  it('states each warning with its severity as a word', () => {
    const trip = buildRankedTrip({
      flight: buildFlightOffer({
        outbound: { ...buildFlightOffer().outbound, selfTransfer: true },
      }),
    });

    render(<WarningList warnings={trip.warnings} />);

    expect(screen.getByText(/not protected by the airline/)).toBeInTheDocument();
    expect(screen.getAllByText('Severity:').length).toBeGreaterThan(0);
  });

  it('says so plainly when nothing is flagged', () => {
    render(<WarningList warnings={[]} />);
    expect(screen.getByText(/Nothing flagged by the No-Surprise check/)).toBeInTheDocument();
  });
});

describe('ScoreExplanation', () => {
  it('shows the score as the sum of the factors it reports', () => {
    const trip = buildRankedTrip();
    render(<ScoreExplanation score={trip.score} />);

    const table = screen.getByRole('table');
    for (const factor of trip.score.factors) {
      expect(within(table).getByRole('rowheader', { name: factor.label })).toBeInTheDocument();
    }

    expect(within(table).getByText(String(trip.score.score))).toBeInTheDocument();
  });
});

describe('TripCard', () => {
  it('names the trip and shows what the whole thing costs', () => {
    const trip = buildRankedTrip();
    render(<TripCard trip={trip} rank={0} />);

    expect(screen.getByRole('heading', { name: 'Antalya from VIE', level: 3 })).toBeInTheDocument();
    expect(screen.getByRole('article', { name: 'Antalya from VIE' })).toBeInTheDocument();
    // Taken from the engine rather than hard-coded: a hard-coded total turns a
    // cost-engine change into a puzzle in a component test. It appears twice -
    // as the headline and as the breakdown's total - and the two must agree.
    expect(screen.getAllByText(format(trip.cost.total)).length).toBeGreaterThanOrEqual(2);
  });

  it('shows warnings without the user having to open anything', () => {
    // The No-Surprise check is worthless behind a disclosure nobody opens.
    const trip = buildRankedTrip({ transfer: null });
    render(<TripCard trip={trip} rank={0} />);

    expect(screen.getByRole('heading', { name: 'Before you book' })).toBeInTheDocument();
    expect(screen.getByText(/No airport transfer was priced/)).toBeInTheDocument();
  });

  it('explains its ranking in the card itself', () => {
    const trip = buildRankedTrip();
    render(<TripCard trip={trip} rank={0} />);

    expect(screen.getByRole('heading', { name: 'Why it ranks here' })).toBeInTheDocument();
    expect(screen.getByText(/Strongest:/)).toBeInTheDocument();
    expect(
      screen.getByText(`How the score of ${trip.score.score} was calculated`),
    ).toBeInTheDocument();
  });

  it('lists every violation when a trip is outside the limits', () => {
    const trip = buildRankedTrip({}, { maxBudget: money(10000, 'EUR') });
    render(<TripCard trip={trip} rank={-1} />);

    expect(screen.getByRole('heading', { name: 'Outside what you asked for' })).toBeInTheDocument();
    expect(screen.getByText(/exceeds the maximum budget/)).toBeInTheDocument();
  });

  it('builds a booking link that cannot reach back through window.opener', () => {
    const trip = buildRankedTrip({
      flight: buildFlightOffer({ deepLink: 'https://example.invalid/book' }),
    });

    render(<TripCard trip={trip} rank={0} />);

    const link = screen.getByRole('link', { name: /Book the flight with mock-flights/ });
    // The sr-only suffix is part of the accessible name, so a screen-reader
    // user is told the link leaves the page before they follow it.
    expect(link).toHaveAccessibleName(/opens in a new tab/);
    expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'));
    expect(link).toHaveAttribute('target', '_blank');
  });

  it('refuses to render a hostile provider link', () => {
    const trip = buildRankedTrip({
      flight: buildFlightOffer({ deepLink: 'javascript:alert(1)' }),
      hotel: buildHotelOffer({ deepLink: undefined }),
    });

    render(<TripCard trip={trip} rank={0} />);

    expect(screen.queryByRole('link', { name: /Book the flight/ })).not.toBeInTheDocument();
    expect(screen.getByText(/did not supply a booking link/)).toBeInTheDocument();
  });

  it('does not label a near miss with a ranking', () => {
    const trip = buildRankedTrip({ transfer: buildTransferOffer() });
    render(<TripCard trip={trip} rank={-1} />);

    expect(screen.queryByText('Best match')).not.toBeInTheDocument();
  });
});

describe('SearchForm', () => {
  it('gives every control a real label', () => {
    render(<SearchForm values={{}} />);

    expect(screen.getByRole('textbox', { name: /Departure airports/ })).toBeInTheDocument();
    expect(screen.getByRole('spinbutton', { name: /Travellers/ })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Travel style' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Direct flights only' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Search trips' })).toBeInTheDocument();
  });

  it('marks an invalid field and announces why', () => {
    render(<SearchForm values={{ origins: 'NOPE' }} errors={{ origins: 'Use three letters.' }} />);

    const input = screen.getByRole('textbox', { name: /Departure airports/ });
    expect(input).toHaveAttribute('aria-invalid', 'true');

    // Every field carries a permanently mounted live region, so the message is
    // found by its text and then checked to be inside one.
    const message = screen.getByText('Use three letters.');
    expect(message).toHaveAttribute('role', 'alert');
    expect(input).toHaveAccessibleDescription(/Use three letters\./);
  });

  it('keeps what the user typed when the form comes back rejected', () => {
    // Retyping a whole form because one field was wrong is its own punishment.
    render(
      <SearchForm values={{ origins: 'BTS', passengers: '4' }} errors={{ passengers: 'No.' }} />,
    );

    expect(screen.getByRole('textbox', { name: /Departure airports/ })).toHaveValue('BTS');
    expect(screen.getByRole('spinbutton', { name: /Travellers/ })).toHaveValue(4);
  });
});

describe('SearchResults counts', () => {
  it('reports how many trips matched, not how many fit on the page', async () => {
    // Titling a capped list "10 trips match" when 192 did would be a number the
    // user could act on and we invented.
    const { SearchResults } = await import('./search-results');
    const trip = buildRankedTrip();

    render(
      <SearchResults
        profile={buildProfile()}
        outcome={{
          results: [trip],
          nearMisses: [],
          routeOffers: [],
          diagnostics: {
            provenance: 'live',
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
            candidatesAssembled: 212,
            candidatesEvaluated: 212,
            eligibleCount: 192,
            ineligibleCount: 20,
            durationMs: 0,
          },
        }}
      />,
    );

    expect(screen.getByRole('heading', { name: '192 trips match' })).toBeInTheDocument();
    expect(screen.getByText(/Showing the best 1\./)).toBeInTheDocument();
  });
});

describe('data provenance', () => {
  it('warns before the results when everything below is fictional', async () => {
    // A notice that the data is fake is worthless underneath the fake data.
    const { SearchResults } = await import('./search-results');
    const trip = buildRankedTrip();

    render(
      <SearchResults
        profile={buildProfile()}
        outcome={
          {
            results: [trip],
            nearMisses: [],
            routeOffers: [],
            diagnostics: buildDiagnostics({ provenance: 'mock' }),
          } as never
        }
      />,
    );

    expect(screen.getByRole('note')).toHaveTextContent('these trips are not real');
    expect(screen.getByText(/Nothing here can be booked/)).toBeInTheDocument();
  });

  it('shows no demo notice when the prices are live', async () => {
    const { SearchResults } = await import('./search-results');
    const trip = buildRankedTrip();

    render(
      <SearchResults
        profile={buildProfile()}
        outcome={
          {
            results: [trip],
            nearMisses: [],
            routeOffers: [],
            diagnostics: buildDiagnostics({ provenance: 'live' }),
          } as never
        }
      />,
    );

    expect(screen.queryByRole('note')).not.toBeInTheDocument();
  });

  it('puts the source beside the price, not in a footnote', () => {
    const trip = buildRankedTrip();
    render(<TripCard trip={trip} rank={0} provenance="mock" />);

    // "€670 · Demo data" has to be readable at the same glance as the price.
    expect(screen.getByText('Demo data')).toBeInTheDocument();
    expect(screen.getAllByText('Data source:').length).toBeGreaterThan(0);
  });

  it('labels a live price as live', () => {
    render(<TripCard trip={buildRankedTrip()} rank={0} provenance="live" />);
    expect(screen.getByText('Live price')).toBeInTheDocument();
  });
});
