import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import type { HomeCard } from './card-data';
import { PopularSection, type PopularSectionProps } from './popular-section';

/**
 * "Popular right now".
 *
 * What is defended: the section is a named region that lists every
 * destination in order, the ranking controls keep their roles and states,
 * what the mosaic does not take lands in the second rail, and an empty world
 * is an explained state with a way forward - not a blank.
 */

const CODES = ['AYT', 'SPU', 'LIS', 'BCN', 'ATH', 'DBV', 'FAO', 'PMI', 'NCE', 'VLC'];

function makeCard(code: string, index: number): HomeCard {
  return {
    code,
    name: `Place ${code}`,
    country: 'Testland',
    label: `from EUR ${400 + index}.00`,
    href: `/?fDest=${code}`,
    actionLabel: 'Show only trips to',
    aboutHref: `/destinations/${code.toLowerCase()}`,
    reason: 'Cheapest trip found here, all in.',
    weather: null,
    bestScore: null,
    savings: null,
    image: null,
  };
}

function renderSection(count: number, overrides: Partial<PopularSectionProps> = {}) {
  const cards = CODES.slice(0, count).map(makeCard);

  return render(
    <PopularSection
      cards={cards}
      totalCount={count}
      mode="cheapest"
      originName="Vienna"
      viewAllHref="/explore"
      controls={{
        mode: 'cheapest',
        modeHref: (mode) => `/?mapMode=${mode}`,
        carry: { origins: 'VIE' },
        counts: {},
        selected: null,
      }}
      {...overrides}
    />,
  );
}

describe('PopularSection', () => {
  it('is a named region listing every destination in order', () => {
    renderSection(5);

    const region = screen.getByRole('region', { name: /5 destinations, ranked by cheapest/ });
    const list = within(region).getByRole('list', { name: 'Destinations' });
    const items = within(list).getAllByRole('listitem');

    expect(items).toHaveLength(5);
    expect(within(items[0]!).getByRole('heading', { level: 3 })).toHaveTextContent('Place AYT');
    expect(within(items[1]!).getByRole('heading', { level: 3 })).toHaveTextContent('Place SPU');
  });

  it('puts what the mosaic does not take in a second rail named for the origin', () => {
    renderSection(10);

    const main = screen.getByRole('list', { name: 'Destinations' });
    expect(within(main).getAllByRole('listitem')).toHaveLength(8);

    const more = screen.getByRole('list', { name: 'From Vienna tonight' });
    expect(within(more).getAllByRole('listitem')).toHaveLength(2);

    expect(screen.getByRole('button', { name: 'Previous destinations' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next destinations' })).toBeInTheDocument();
  });

  it('has no second rail when the mosaic takes everything', () => {
    renderSection(6);

    expect(screen.queryByRole('list', { name: /tonight/ })).toBeNull();
  });

  it('keeps fewer than three destinations in the rail rather than a lopsided mosaic', () => {
    renderSection(2);

    const list = screen.getByRole('list', { name: 'Destinations' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(2);
  });

  it('wears one chip on each of the first three cards, from the ranking', () => {
    renderSection(3);

    expect(screen.getAllByText('Cheapest').length).toBeGreaterThan(0);
    expect(screen.getByText('Runner-up')).toBeInTheDocument();
    expect(screen.getByText('Third')).toBeInTheDocument();
  });

  it('marks the ranking in force with aria-current, and links the others by URL', () => {
    renderSection(3);

    const nav = screen.getByRole('navigation', { name: 'Rank by' });
    expect(within(nav).getByRole('link', { name: 'Cheapest' })).toHaveAttribute(
      'aria-current',
      'true',
    );
    expect(within(nav).getByRole('link', { name: 'Fastest' })).toHaveAttribute(
      'href',
      '/?mapMode=fastest',
    );
    expect(within(nav).getByRole('link', { name: 'Fastest' })).not.toHaveAttribute('aria-current');
  });

  it('has a labelled region select that submits by GET and carries the search', () => {
    const { container } = renderSection(3);

    expect(screen.getByRole('combobox', { name: 'Explore a country' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Go' })).toBeInTheDocument();
    expect(container.querySelector('form')).toHaveAttribute('method', 'get');
    expect(container.querySelector('input[name="origins"]')).toHaveValue('VIE');
  });

  it('says why nothing is shown, and where to go, when nothing is priced', () => {
    renderSection(0);

    expect(screen.getByText('Nothing priced from Vienna yet')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Open the search/ })).toHaveAttribute(
      'href',
      '/explore',
    );
    expect(screen.queryByRole('list', { name: 'Destinations' })).toBeNull();
  });

  it('keeps the note about what it cannot yet compare', () => {
    renderSection(3);

    expect(screen.getByText(/Flights only for now/)).toBeInTheDocument();
  });

  it('says prices could not be produced rather than showing an empty world', () => {
    renderSection(0, { unpriced: true });

    expect(screen.getByRole('status')).toHaveTextContent(/Prices could not be produced/);
  });
});
