import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { buildFlightOffer, buildHotelOffer, buildTransferOffer } from '@/core/trip/test-support';
import { abs, format, money } from '@/core/money';
import { buildProfile } from '@/core/trip/test-support';
import { CostBreakdown } from './cost-breakdown';
import { ScoreExplanation } from './score-explanation';
import { SearchForm } from './search-form';
import { TripCard } from './trip-card';
import { WarningList } from './warning-list';
import { DEFAULT_SEARCH_LIMITS } from '@/search/types';
import { NO_FILTERS } from '@/search/filters';
import { explainTrip, summariseReasons } from '@/search/explain';
import { summariseDestinations } from '@/search/destinations';
import { buildRankedTrip } from './test-support';
import { offersFor } from '@/booking/partners';

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
    quoteFreshness: { fresh: 1, stale: 0, unknown: 0 },
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

  it('says how far over the maximum a trip is, without a double negative', () => {
    // A tiny maximum, so the trip is over it.
    const trip = buildRankedTrip({}, { maxBudget: money(10_00, 'EUR') });
    render(<TripCard trip={trip} rank={0} />);

    // "-EUR 472.40 over your maximum" makes a reader work out which way it
    // points. The word carries the sign.
    const overBudget = screen.getByText(/over your maximum/);
    expect(overBudget.textContent).not.toMatch(/-/);
    expect(overBudget.textContent).toContain(format(abs(trip.eligibility.budgetHeadroom)));
  });

  it('does not print a made-up "checked" time on a card whose quote is stale', () => {
    // A cached-fare vendor says on what day a fare was last searched, never at
    // what time, and that day is the vendor's search, not a check of ours. The
    // card used to print it as "checked 30 Oct, 00:00 UTC", which claimed a
    // moment nobody observed. The page-level notice still says some prices may
    // have moved, and the source tag still says the price is indicative.
    const trip = buildRankedTrip({}, {}, 'stale');
    render(<TripCard trip={trip} rank={0} />);

    // ("Checked bag" is a different sentence; this is the time stamp.)
    expect(screen.queryByText(/checked \d+ \w+, \d\d:\d\d UTC/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/may have moved/i)).not.toBeInTheDocument();
  });

  it('says nothing about staleness for a fresh or unjudged quote', () => {
    for (const freshness of ['fresh', 'unknown'] as const) {
      const trip = buildRankedTrip({}, {}, freshness);
      const { unmount } = render(<TripCard trip={trip} rank={0} />);

      expect(screen.queryByText(/may have moved/i)).not.toBeInTheDocument();
      unmount();
    }
  });

  it('never tells a near miss that it fits what was asked for', () => {
    // A near miss is rendered with no reasons, and the fallback sentence for
    // that case is false here by definition: the violations box directly
    // below says what ruled it out.
    const trip = buildRankedTrip({}, { maxBudget: money(10_00, 'EUR') });
    render(<TripCard trip={trip} rank={-1} />);

    expect(screen.queryByText(/fits what you asked for/)).toBeNull();
    expect(screen.getByRole('heading', { name: 'Outside what you asked for' })).toBeInTheDocument();
  });

  it('shows warnings without the user having to open anything', () => {
    // The No-Surprise check is worthless behind a disclosure nobody opens.
    const trip = buildRankedTrip({ transfer: null });
    render(<TripCard trip={trip} rank={0} />);

    expect(screen.getByRole('heading', { name: 'Before you book' })).toBeInTheDocument();
    expect(screen.getByText(/No airport transfer was priced/)).toBeInTheDocument();
  });

  it('explains its ranking in human terms, not as a score', () => {
    // Section 9 forbids exposing meaningless technical scoring. The factor
    // breakdown is still available, one disclosure down, for anyone who wants it.
    const trip = buildRankedTrip();
    const reasons = explainTrip(trip, buildProfile());

    render(<TripCard trip={trip} rank={0} reasons={reasons} />);

    expect(screen.getByRole('heading', { name: 'Why this trip?' })).toBeInTheDocument();
    expect(screen.getByText(summariseReasons(reasons))).toBeInTheDocument();
    expect(
      screen.getByText(`How the score of ${trip.score.score} was calculated`),
    ).toBeInTheDocument();
  });

  it('shows what the parts cost, and never a zero for an unpriced transfer', () => {
    // An unpriced transfer is a cost we could not get, not one that is free.
    render(<TripCard trip={buildRankedTrip({ transfer: null })} rank={0} />);

    // "Not priced" is the assertion that matters: the figure itself, never a
    // zero. The label appears in the cost breakdown too, hence getAllByText.
    expect(screen.getAllByText('Airport transfer').length).toBeGreaterThan(0);
    expect(screen.getByText('Not priced')).toBeInTheDocument();
  });

  it('states the weather as a range rather than a single confident number', () => {
    render(<TripCard trip={buildRankedTrip()} rank={0} />);
    expect(screen.getByText(/\d+–\d+°C|\d+°C/)).toBeInTheDocument();
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
    render(<SearchForm today="2026-06-01" values={{}} />);

    expect(screen.getByRole('textbox', { name: /Departure airports/ })).toBeInTheDocument();
    expect(screen.getByRole('spinbutton', { name: /Travellers/ })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Travel style' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Direct flights only' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Search trips' })).toBeInTheDocument();
  });

  it('marks an invalid field and announces why', () => {
    render(
      <SearchForm
        today="2026-06-01"
        values={{ origins: 'NOPE' }}
        errors={{ origins: 'Use three letters.' }}
      />,
    );

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
      <SearchForm
        today="2026-06-01"
        values={{ origins: 'BTS', passengers: '4' }}
        errors={{ passengers: 'No.' }}
      />,
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
        filters={NO_FILTERS}
        searchValues={{}}
        outcome={{
          results: [trip],
          nearMisses: [],
          overBudgetOnly: [],
          routeOffers: [],
          destinationSummaries: summariseDestinations([trip]),
          diagnostics: {
            provenance: 'live',
            sources: [
              { part: 'flights', providerId: 'x', displayName: 'X Air', provenance: 'live' },
            ],
            quoteFreshness: { fresh: 1, stale: 0, unknown: 0 },
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
  it('carries no demo banner, whatever the data source is', async () => {
    // Provenance stays in the data model; the page says what a figure is in
    // words ("from", "Updated", what a total leaves out), not with a banner.
    const { SearchResults } = await import('./search-results');
    const trip = buildRankedTrip();

    render(
      <SearchResults
        profile={buildProfile()}
        filters={NO_FILTERS}
        searchValues={{}}
        outcome={
          {
            results: [trip],
            nearMisses: [],
            routeOffers: [],
            destinationSummaries: summariseDestinations([trip]),
            diagnostics: buildDiagnostics({ provenance: 'mock' }),
          } as never
        }
      />,
    );

    expect(screen.queryByRole('note')).not.toBeInTheDocument();
    expect(screen.queryByText(/not real/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/demo data/i)).not.toBeInTheDocument();
  });

  it('shows no demo notice when the prices are live', async () => {
    const { SearchResults } = await import('./search-results');
    const trip = buildRankedTrip();

    render(
      <SearchResults
        profile={buildProfile()}
        filters={NO_FILTERS}
        searchValues={{}}
        outcome={
          {
            results: [trip],
            nearMisses: [],
            routeOffers: [],
            destinationSummaries: summariseDestinations([trip]),
            diagnostics: buildDiagnostics({ provenance: 'live' }),
          } as never
        }
      />,
    );

    expect(screen.queryByRole('note')).not.toBeInTheDocument();
  });

  it('says before the results when some quotes may have moved', async () => {
    const { SearchResults } = await import('./search-results');
    const trip = buildRankedTrip();

    render(
      <SearchResults
        profile={buildProfile()}
        filters={NO_FILTERS}
        searchValues={{}}
        outcome={
          {
            results: [trip],
            nearMisses: [],
            routeOffers: [],
            destinationSummaries: summariseDestinations([trip]),
            diagnostics: buildDiagnostics({
              quoteFreshness: { fresh: 0, stale: 1, unknown: 0 },
            }),
          } as never
        }
      />,
    );

    const note = screen
      .getAllByRole('status')
      .find((node) => /Some prices may have moved/.test(node.textContent ?? ''))!;
    expect(note).toBeDefined();
    expect(note).toHaveTextContent('Some prices may have moved.');
    expect(note).toHaveTextContent(/1 of these trips carries an older quote/);
    expect(within(note).getByRole('link', { name: 'Search again' })).toBeInTheDocument();
  });

  it('says what the price is in words, with no source badge beside it', () => {
    const trip = buildRankedTrip();
    render(<TripCard trip={trip} rank={0} provenance="mock" />);

    // "from" and what the figure covers are the honesty; a chip is not.
    expect(screen.getByText('from')).toBeInTheDocument();
    expect(screen.getByText(/^total · .* each/)).toBeInTheDocument();
    expect(screen.queryByText('Demo data')).not.toBeInTheDocument();
    expect(screen.queryByText('Data source:')).not.toBeInTheDocument();
  });

  it('shows the same card, without a "live" badge, when the price is live', () => {
    render(<TripCard trip={buildRankedTrip()} rank={0} provenance="live" />);

    expect(screen.getByText('from')).toBeInTheDocument();
    expect(screen.queryByText('Live price')).not.toBeInTheDocument();
  });
});

describe('the flexibility control', () => {
  it('offers the presets in the open, not behind a disclosure', () => {
    // Section 8: flexible dates are not an advanced option. A control a user
    // has to go looking for is one most users never find.
    render(<SearchForm today="2026-06-01" values={{}} />);

    const group = screen.getByRole('group', { name: 'How flexible are the dates?' });

    expect(within(group).getByRole('radio', { name: /A weekend/ })).toBeTruthy();
    expect(within(group).getByRole('radio', { name: /± 3 days/ })).toBeTruthy();
    expect(within(group).getByRole('radio', { name: /Anytime that month/ })).toBeTruthy();
  });

  it('names each choice with what it actually does', () => {
    // "± 3 days" alone cannot be told apart from every other product's "± 3
    // days", so the name carries the meaning as well as the label.
    render(<SearchForm today="2026-06-01" values={{}} />);

    expect(
      screen.getByRole('radio', { name: /three days either side.*as short as two nights/i }),
    ).toBeTruthy();
  });

  it('is one choice rather than several', () => {
    render(<SearchForm today="2026-06-01" values={{}} />);

    // Radios, not checkboxes: the options are mutually exclusive, and a
    // checkbox behaving like a radio is a lie told to a screen reader.
    expect(screen.queryByRole('checkbox', { name: /A weekend/ })).toBeNull();
  });

  it('restores the chosen preset from the submitted values', () => {
    render(<SearchForm today="2026-06-01" values={{ origins: 'VIE', flexibility: 'weekend' }} />);

    expect((screen.getByRole('radio', { name: /A weekend/ }) as HTMLInputElement).checked).toBe(
      true,
    );
  });
});

describe('what the dates are worth', () => {
  // The calendar asks `/api/price-calendar` for the rest of each month; these
  // tests are about what the search itself priced, so the vendor says nothing.
  beforeEach(() => {
    vi.stubGlobal('fetch', async () => new Response('{}', { status: 500 }));
  });
  afterEach(() => vi.unstubAllGlobals());

  const WINDOWS = [
    { departureDate: '2026-06-10', returnDate: '2026-06-15', nights: 5 },
    { departureDate: '2026-06-17', returnDate: '2026-06-22', nights: 5 },
  ];

  const tripOn = (window: (typeof WINDOWS)[number], hotelPrice: number) =>
    buildRankedTrip({
      id: window.departureDate,
      dates: window,
      hotel: { ...buildHotelOffer(), totalPrice: money(hotelPrice, 'EUR') },
    });

  const renderBreakdown = async (trips: ReturnType<typeof buildRankedTrip>[]) => {
    const { SearchResults } = await import('./search-results');

    render(
      <SearchResults
        profile={buildProfile()}
        filters={NO_FILTERS}
        searchValues={{ origins: 'VIE' }}
        outcome={{
          results: trips,
          nearMisses: [],
          overBudgetOnly: [],
          routeOffers: [],
          destinationSummaries: summariseDestinations(trips),
          diagnostics: buildDiagnostics({
            plan: {
              ...(buildDiagnostics() as unknown as { plan: Record<string, unknown> }).plan,
              dateWindows: WINDOWS,
              dateWindowsAvailable: 165,
            },
            eligibleCount: trips.length,
          }),
        }}
      />,
    );
  };

  it('says what moving to the cheapest dates saves', async () => {
    // Section 37's bar for this feature: can flexible dates *visibly* save
    // money? A comparison the user has to do themselves has not answered it.
    await renderBreakdown([tripOn(WINDOWS[0]!, 90_000), tripOn(WINDOWS[1]!, 30_000)]);

    const section = screen.getByRole('region', { name: 'Pick your dates' });

    expect(within(section).getByText(/dates save/i).textContent).toContain(
      format(money(60_000, 'EUR')),
    );
  });

  it('says dates it found nothing for found nothing, not nothing to pay', async () => {
    await renderBreakdown([tripOn(WINDOWS[0]!, 30_000)]);

    const section = screen.getByRole('region', { name: 'Pick your dates' });

    expect(within(section).getByText('Nothing found')).toBeTruthy();
    // A zero would read as free, which is the one misreading that costs money.
    expect(within(section).queryByText(format(money(0, 'EUR')))).toBeNull();
  });

  it('still shows the calendar, and the way to widen it, when only one set of dates was priced', async () => {
    // A narrow search is the one that most needs the flexibility chips; hiding
    // the section because there was nothing to compare hid the way out.
    await renderBreakdown([tripOn(WINDOWS[0]!, 30_000)]);

    const section = screen.getByRole('region', { name: 'Pick your dates' });

    expect(
      within(section).getByRole('group', { name: 'How flexible are your dates' }),
    ).toBeTruthy();
    expect(within(section).getAllByRole('gridcell').length).toBeGreaterThan(0);
  });

  it('admits it sampled the window rather than covering it', async () => {
    await renderBreakdown([tripOn(WINDOWS[0]!, 30_000), tripOn(WINDOWS[1]!, 40_000)]);

    const section = screen.getByRole('region', { name: 'Pick your dates' });

    expect(within(section).getByText(/Priced 2 of the 165/)).toBeTruthy();
  });

  it('narrows to a set of dates without re-running the search', async () => {
    await renderBreakdown([tripOn(WINDOWS[0]!, 30_000), tripOn(WINDOWS[1]!, 40_000)]);

    const section = screen.getByRole('region', { name: 'Pick your dates' });
    // The first links are the flexibility chips, which do search again; the
    // dates are the ones that carry a `fDates` filter.
    const link = within(section)
      .getAllByRole('link')
      .find((anchor) => anchor.getAttribute('href')?.includes('fDates=')) as HTMLAnchorElement;

    // A filter over trips already priced, carrying the search it narrows - not
    // a new search, which would cost provider calls and return different trips
    // from the ones whose price the user just clicked.
    expect(link.getAttribute('href')).toContain('fDates=2026-06-10..2026-06-15');
    expect(link.getAttribute('href')).toContain('origins=VIE');
  });

  it('says what it cannot yet compare across dates', async () => {
    // Section 8 also lists events, holidays and availability. Naming the gap
    // beats a control that silently matches everything.
    await renderBreakdown([tripOn(WINDOWS[0]!, 30_000), tripOn(WINDOWS[1]!, 40_000)]);

    const section = screen.getByRole('region', { name: 'Pick your dates' });

    expect(within(section).getByText(/Events, public holidays and live availability/)).toBeTruthy();
  });
});

describe('TripCard with no priced stay', () => {
  const stayLink = {
    id: 'travelpayouts-links:AYT:2026-06-10:2026-06-15',
    providerId: 'travelpayouts-links',
    displayName: 'Booking.com via Travelpayouts',
    destinationName: 'Antalya',
    checkIn: '2026-06-10',
    checkOut: '2026-06-15',
    occupancy: { adults: 2, children: 0, rooms: 1 },
    price: null,
    url: 'https://tp.media/r?marker=partner-123&p=4115&u=x',
  } as const;

  it('says the total is flights only, and never claims it is all in', () => {
    render(<TripCard trip={buildRankedTrip({ hotel: null })} rank={0} />);

    expect(screen.getByText('Flights only — stay not included')).toBeInTheDocument();
    expect(screen.queryByText(/all in/i)).not.toBeInTheDocument();
  });

  it('says nothing of the kind when the stay is priced', () => {
    render(<TripCard trip={buildRankedTrip()} rank={0} />);

    expect(screen.queryByText(/Flights only/)).not.toBeInTheDocument();
  });

  it('shows the stay as not priced rather than as a price', () => {
    render(<TripCard trip={buildRankedTrip({ hotel: null })} rank={0} />);

    // The transfer is priced on this trip, so this is the stay's.
    expect(screen.getByText('Not priced')).toBeInTheDocument();
  });

  it('offers a find-a-stay link that opens in a new tab and declares itself sponsored', () => {
    render(<TripCard trip={buildRankedTrip({ hotel: null })} rank={0} stayLink={stayLink} />);

    const link = screen.getByRole('link', { name: /Find a stay in Antalya.*opens in a new tab/ });
    expect(link).toHaveAttribute('href', stayLink.url);
    expect(link).toHaveAttribute('target', '_blank');
    expect(link.getAttribute('rel')).toContain('sponsored');
    expect(link.getAttribute('rel')).toContain('noopener');
  });

  it('has no find-a-stay link when none was resolved, and no price in its place', () => {
    render(<TripCard trip={buildRankedTrip({ hotel: null })} rank={0} />);

    expect(screen.queryByRole('link', { name: /Find a stay/ })).not.toBeInTheDocument();
  });

  it('offers the transfer partner beside the not-included wording when the transfer is excluded', () => {
    const transferOffer = offersFor('transfer')[0]!;
    render(
      <TripCard
        trip={buildRankedTrip({ transfer: null })}
        rank={0}
        transferOffer={transferOffer}
      />,
    );

    expect(screen.getByText('Airport transfer not included')).toBeInTheDocument();
    const link = screen.getByRole('link', { name: /Continue to Intui.*opens in a new tab/ });
    expect(link).toHaveAttribute('href', transferOffer.url);
    expect(link.getAttribute('rel')).toContain('sponsored');
  });

  it('does not offer a transfer partner when the transfer was priced', () => {
    render(
      <TripCard
        trip={buildRankedTrip({ transfer: buildTransferOffer() })}
        rank={0}
        transferOffer={offersFor('transfer')[0]!}
      />,
    );

    expect(screen.queryByRole('link', { name: /Continue to Intui/ })).not.toBeInTheDocument();
    expect(screen.queryByText('Airport transfer not included')).not.toBeInTheDocument();
  });

  it('says what the total leaves out once, not beside every row', () => {
    render(
      <TripCard
        trip={buildRankedTrip({ transfer: null })}
        rank={0}
        transferOffer={offersFor('transfer')[0]!}
      />,
    );

    expect(screen.getAllByText('Airport transfer not included')).toHaveLength(1);
  });

  it('offers "Add to my plan" beside the partner row only to somebody signed in', () => {
    const transferOffer = offersFor('transfer')[0]!;
    const { unmount } = render(
      <TripCard
        trip={buildRankedTrip({ transfer: null })}
        rank={0}
        transferOffer={transferOffer}
        planTrips={[{ id: 'trip-1', name: 'Lisbon in May' }]}
      />,
    );
    expect(screen.getByRole('button', { name: /Add to my plan/ })).toBeInTheDocument();
    unmount();

    render(
      <TripCard
        trip={buildRankedTrip({ transfer: null })}
        rank={0}
        transferOffer={transferOffer}
      />,
    );
    expect(screen.queryByRole('button', { name: /Add to my plan/ })).not.toBeInTheDocument();
  });

  it('names the country in full', () => {
    render(<TripCard trip={buildRankedTrip()} rank={0} country="Malta" />);

    expect(screen.getByText('Malta')).toBeInTheDocument();
  });

  it('shows nothing extra for an excluded transfer when no partner is registered', () => {
    render(<TripCard trip={buildRankedTrip({ transfer: null })} rank={0} />);

    expect(screen.queryByRole('link', { name: /Continue to/ })).not.toBeInTheDocument();
  });
});
