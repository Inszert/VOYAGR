import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import type { HomeCard } from './card-data';
import { DestinationCard } from './destination-card';

/**
 * The home page's destination card.
 *
 * What is defended: the whole card is one named link, the picture says what
 * it is (and says so when it was generated), a card with no picture still
 * says which country it is, and there is no provenance badge anywhere.
 */

function makeCard(overrides: Partial<HomeCard> = {}): HomeCard {
  return {
    code: 'AYT',
    name: 'Antalya',
    country: 'Turkey',
    label: 'from EUR 401.00',
    href: '/?fDest=AYT',
    actionLabel: 'Show only trips to',
    aboutHref: '/destinations/ayt',
    reason: 'Cheapest trip found here, all in.',
    weather: { maxC: 29, wet: false },
    bestScore: 78,
    savings: null,
    image: { kind: 'local', blur: 'data:image/webp;base64,AAAA' },
    ...overrides,
  };
}

function renderCard(card: HomeCard, chip: string | null = null) {
  return render(
    <ul>
      <DestinationCard card={card} chip={chip} sizes="320px" />
    </ul>,
  );
}

describe('DestinationCard', () => {
  it('is one link, named with the action, the place, the country in full and the price', () => {
    renderCard(makeCard());

    const link = screen.getByRole('link', {
      name: 'Show only trips to Antalya, Turkey, from EUR 401.00',
    });
    expect(link).toHaveAttribute('href', '/?fDest=AYT');
  });

  it('keeps the place reachable with a separate About link', () => {
    renderCard(makeCard());

    expect(screen.getByRole('link', { name: 'About Antalya' })).toHaveAttribute(
      'href',
      '/destinations/ayt',
    );
  });

  it('names a generated picture as an illustration', () => {
    renderCard(makeCard());

    expect(
      screen.getByRole('img', { name: 'Antalya, Turkey — AI-generated illustration' }),
    ).toBeInTheDocument();
  });

  it('describes a photograph by place alone', () => {
    renderCard(
      makeCard({
        image: {
          kind: 'remote',
          src: '/api/imagery/AYT',
          credit: { author: 'A. Person', licence: 'CC BY-SA 4.0', pageUrl: 'https://example.org' },
        },
      }),
    );

    expect(screen.getByRole('img', { name: 'Antalya, Turkey' })).toBeInTheDocument();
  });

  it('draws no image when there is none, and still names the country in full', () => {
    renderCard(makeCard({ image: null }));

    expect(screen.queryByRole('img')).toBeNull();
    expect(screen.getByText('Turkey')).toBeInTheDocument();
  });

  it('prints the destination as a heading and the country in full', () => {
    renderCard(makeCard({ country: 'Czech Republic', name: 'Prague' }));

    const item = screen.getByRole('listitem');
    expect(within(item).getByRole('heading', { level: 3 })).toHaveTextContent('Prague');
    expect(within(item).getByText('Czech Republic')).toBeInTheDocument();
  });

  it('draws a savings line only when the data has one', () => {
    const { unmount } = renderCard(makeCard());
    expect(screen.queryByText(/saves/i)).toBeNull();
    unmount();

    renderCard(makeCard({ savings: 'Saves EUR 80 against the usual' }));
    expect(screen.getByText('Saves EUR 80 against the usual')).toBeInTheDocument();
  });

  it('wears at most one chip, and no provenance badge', () => {
    renderCard(makeCard(), 'Cheapest');

    expect(screen.getByText('Cheapest')).toBeInTheDocument();
    expect(screen.queryByText(/indicative|demo data|mock/i)).toBeNull();
  });

  it('says in words what the weather glyph says', () => {
    renderCard(makeCard({ weather: { maxC: 17, wet: true } }));

    expect(screen.getByText(/warmest day, rain likely/)).toBeInTheDocument();
    expect(screen.getByText('17°C')).toBeInTheDocument();
  });

  it('prints a price it cannot split exactly as it came', () => {
    renderCard(makeCard({ label: 'Nothing priced' }));

    expect(screen.getByText('Nothing priced')).toBeInTheDocument();
  });
});
