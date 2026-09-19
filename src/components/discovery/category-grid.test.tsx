import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { DISCOVERY_CATEGORIES } from '@/discovery/categories';
import { CategoryGrid } from './category-grid';

/**
 * The discovery grid.
 *
 * Assertions are on what a user can perceive and operate: a named list of
 * links that each go somewhere real. Nothing asserts on the gradients, which
 * are decoration and carry no meaning.
 */

const TODAY = '2026-09-19';

describe('CategoryGrid', () => {
  it('offers every category as a link', () => {
    render(<CategoryGrid today={TODAY} />);

    const list = screen.getByRole('list');
    expect(within(list).getAllByRole('link')).toHaveLength(DISCOVERY_CATEGORIES.length);
  });

  it('names what each tile changes, not just what it is called', () => {
    // A tile called "Beach escapes" with no explanation is decoration. The
    // description is what makes it a choice rather than a guess.
    render(<CategoryGrid today={TODAY} />);

    expect(screen.getByRole('link', { name: /Beach escapes/ })).toBeInTheDocument();
    expect(screen.getByText(/Ranks sun, sea temperature/)).toBeInTheDocument();
  });

  it('sends each tile to a real search', () => {
    render(<CategoryGrid today={TODAY} />);

    const link = screen.getByRole('link', { name: /Travel cheaply/ });
    const href = link.getAttribute('href') ?? '';

    expect(href.startsWith('/?')).toBe(true);
    expect(href).toContain('optimisationMode=cheapest');
    expect(href).toContain('origins=');
  });

  it('is a list, so its size and end are announced', () => {
    // A grid of bare links tells a screen reader nothing about how many
    // choices there are or where they stop.
    render(<CategoryGrid today={TODAY} />);

    expect(screen.getByRole('list')).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(DISCOVERY_CATEGORIES.length);
  });

  it('carries the traveller’s own defaults into every link', () => {
    render(<CategoryGrid today={TODAY} defaults={{ origins: 'BTS', passengers: '4' }} />);

    for (const link of screen.getAllByRole('link')) {
      const href = link.getAttribute('href') ?? '';
      expect(href).toContain('origins=BTS');
      expect(href).toContain('passengers=4');
    }
  });

  it('points a seasonal tile at the next occurrence of its season', () => {
    render(<CategoryGrid today={TODAY} />);

    const href = screen.getByRole('link', { name: /Warm escape/ }).getAttribute('href') ?? '';
    expect(href).toContain('earliestDeparture=2026-11-01');
  });

  it('shows no imagery, because none of it would be real', () => {
    // docs/imagery-options.md: wiring an imagery API to decorate fixture
    // destinations would add a third party, an attribution obligation and a
    // rate limit in order to illustrate data that is not real.
    const { container } = render(<CategoryGrid today={TODAY} />);

    expect(container.querySelectorAll('img')).toHaveLength(0);
  });
});
