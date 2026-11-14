import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { money } from '@/core/money';
import type { DestinationPoint } from '@/discovery/map-model';
import { DestinationRail, type RailCard } from './destination-rail';

/**
 * The destination rail.
 *
 * What is defended: the rail is the globe in words. Every card is a link
 * that says what it does, every price wears its provenance, every ranking
 * explains itself, and a country with nothing priced says so rather than
 * showing an empty region.
 */

function point(overrides: Partial<DestinationPoint> = {}): DestinationPoint {
  return {
    destination: 'AYT',
    name: 'Antalya',
    country: 'Turkey',
    adm0: 'TUR',
    position: [30.79, 36.9],
    tier: 'major',
    cheapestTotal: money(40_100, 'EUR'),
    excludedCategories: [],
    bestScore: 78,
    fastestMinutes: 330,
    fewestStops: 0,
    weather: null,
    tripCount: 12,
    reason: 'Cheapest trip found here, all in.',
    ...overrides,
  };
}

function card(overrides: Partial<DestinationPoint> = {}, label = 'from EUR 401.00'): RailCard {
  const p = point(overrides);
  return {
    point: p,
    label,
    href: `/?fDest=${p.destination}`,
    actionLabel: 'Show only trips to',
    aboutHref: `/destinations/${p.destination.toLowerCase()}`,
  };
}

const ASSUMPTIONS = {
  origins: ['VIE'],
  passengers: 2,
  currency: 'EUR',
  earliestDeparture: '2026-09-27',
  latestReturn: '2026-11-26',
  minNights: 4,
  maxNights: 7,
};

describe('DestinationRail', () => {
  it('is a named region listing every destination in order', () => {
    render(
      <DestinationRail
        cards={[card(), card({ destination: 'SPU', name: 'Split', country: 'Croatia' })]}
        totalCount={2}
        mode="cheapest"
        provenance="mock"
      />,
    );

    const region = screen.getByRole('region', { name: /2 destinations, ranked by cheapest/ });
    const items = within(region).getAllByRole('listitem');

    expect(items).toHaveLength(2);
    expect(within(items[0]!).getByRole('heading', { level: 3 })).toHaveTextContent('Antalya');
    expect(within(items[1]!).getByRole('heading', { level: 3 })).toHaveTextContent('Split');
  });

  it('states the assumptions the prices were made under', () => {
    render(
      <DestinationRail
        cards={[card()]}
        totalCount={1}
        mode="cheapest"
        provenance="mock"
        assumptions={ASSUMPTIONS}
      />,
    );

    expect(
      screen.getByText(/Priced for 2 travellers from VIE, 4 to 7 nights, 27 Sep to 26 Nov, in EUR/),
    ).toBeInTheDocument();
  });

  it('shows the price with its "from" and explains the ranking, with no badge on the card', () => {
    render(<DestinationRail cards={[card()]} totalCount={1} mode="cheapest" provenance="mock" />);

    // The prefix and the figure are separate elements so "from" can sit back
    // at the weight of a prefix, so the assertion is on what the row reads as
    // rather than on it being one text node.
    expect(
      screen.getByText(
        (_, element) => element?.textContent === 'from EUR 401.00' && element.tagName === 'SPAN',
      ),
    ).toBeInTheDocument();
    // The owner asked for the per-card badge to go; honesty is in the words
    // around the cards ("from", the line under the hero, the updated-ago line).
    expect(screen.queryByText('Demo data')).not.toBeInTheDocument();
    expect(screen.getByText('Cheapest trip found here, all in.')).toBeInTheDocument();
  });

  it('names what each link does before what it says', () => {
    render(<DestinationRail cards={[card()]} totalCount={1} mode="cheapest" provenance="mock" />);

    expect(screen.getByRole('link', { name: 'Show only trips to Antalya' })).toHaveAttribute(
      'href',
      '/?fDest=AYT',
    );
    expect(screen.getByRole('link', { name: 'About Antalya' })).toHaveAttribute(
      'href',
      '/destinations/ayt',
    );
  });

  it('says plainly when a country has nothing priced, and offers the way back', () => {
    render(
      <DestinationRail
        cards={[]}
        totalCount={8}
        mode="best-value"
        provenance="mock"
        country={{
          adm0: 'KAZ',
          iso2: 'KZ',
          name: 'Kazakhstan',
          shortName: 'Kazakhstan',
          continent: 'Asia',
          subregion: 'Central Asia',
          bbox: [46.5, 40.6, 87.4, 55.4],
        }}
        clearHref="/"
      />,
    );

    expect(
      screen.getByRole('heading', { level: 2, name: 'Nothing priced in Kazakhstan yet' }),
    ).toBeInTheDocument();
    expect(screen.getByText(/no airport in Kazakhstan yet/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Show the whole world \(8\)/ })).toHaveAttribute(
      'href',
      '/',
    );
  });

  it('says what it cannot yet compare', () => {
    render(<DestinationRail cards={[card()]} totalCount={1} mode="fastest" provenance="mock" />);

    // One sentence at the weight of a note; it used to open with the first
    // four words in bold, which is why this could match them exactly.
    expect(screen.getByText(/^Flights only for now/)).toBeInTheDocument();
  });
});
