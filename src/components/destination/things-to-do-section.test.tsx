import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import type { ThingsToDoOutcome } from '@/discovery/things-to-do';
import type { ThingKind, ThingToDo } from '@/providers/types';
import { ThingsToDoSection, ThingsToDoSkeleton } from './things-to-do-section';

vi.mock('@/app/actions/trips', () => ({ addToMyPlanAction: vi.fn() }));

/**
 * What a reader is told: roles, names and text, never class names.
 *
 * The rules defended are the product's. A place with no picture shows a plain
 * tile and not an invented photograph; nothing is scored; a link that leaves
 * the site says so; the current filter is announced; and nothing renders when
 * there is no real list to show.
 */

function thing(overrides: Partial<ThingToDo> & { id: string }): ThingToDo {
  return {
    providerId: 'wikidata',
    name: `Place ${overrides.id}`,
    kind: 'sights',
    description: null,
    latitude: 36.9,
    longitude: 30.7,
    distanceFromCentreMetres: 2780,
    notability: 10,
    wikipediaUrl: null,
    imageFile: null,
    ...overrides,
  };
}

const GATE = thing({
  id: 'Q1',
  name: "Hadrian's Gate",
  description: 'triumphal arch in Antalya',
  wikipediaUrl: 'https://en.wikipedia.org/wiki/Hadrian%27s_Gate',
  imageFile: 'Hadrian Gate.jpg',
});
const MUSEUM = thing({
  id: 'Q2',
  name: 'Antalya Museum',
  kind: 'museums',
  distanceFromCentreMetres: 849,
});
const BEACH = thing({
  id: 'Q3',
  name: 'Konyaaltı Beach',
  kind: 'outdoors',
  distanceFromCentreMetres: 12600,
});

function outcome(
  things: ThingToDo[],
  extra: Partial<Extract<ThingsToDoOutcome, { status: 'ok' }>> = {},
) {
  return {
    status: 'ok',
    things,
    credits: {},
    sample: false,
    ageMs: null,
    ...extra,
  } satisfies ThingsToDoOutcome;
}

const hrefFor = (kind: ThingKind | null) =>
  kind ? `?kind=${kind}#things-heading` : '?#things-heading';

function renderSection(things: ThingToDo[], kind: ThingKind | null = null, extra = {}) {
  return render(
    <ThingsToDoSection
      outcome={outcome(things, extra)}
      city="Antalya"
      hrefFor={hrefFor}
      kind={kind}
    />,
  );
}

describe('ThingsToDoSection', () => {
  it('names the city and counts the places', () => {
    renderSection([GATE, MUSEUM, BEACH]);

    expect(
      screen.getByRole('heading', { level: 2, name: 'Things to do in Antalya' }),
    ).toBeVisible();
    expect(screen.getByText('3 places')).toBeVisible();
  });

  it('says "1 place" for one, and nothing at all for none', () => {
    const { container, unmount } = renderSection([GATE]);
    expect(screen.getByText('1 place')).toBeVisible();
    unmount();

    const empty = renderSection([]);
    expect(empty.container).toBeEmptyDOMElement();
    expect(container).toBeDefined();
  });

  it('renders nothing when there is no real list: absent or unavailable', () => {
    for (const status of ['absent', 'unavailable'] as const) {
      const { container, unmount } = render(
        <ThingsToDoSection outcome={{ status }} city="Antalya" hrefFor={hrefFor} kind={null} />,
      );
      expect(container).toBeEmptyDOMElement();
      unmount();
    }
  });

  it('draws a card per place with its kind, one-line description and distance from the centre', () => {
    renderSection([GATE, MUSEUM, BEACH]);

    const gate = screen.getByRole('heading', { level: 3, name: "Hadrian's Gate" }).closest('li')!;
    expect(within(gate).getByText('Sights')).toBeVisible();
    // The source writes a phrase; a card starts a sentence.
    expect(within(gate).getByText('Triumphal arch in Antalya')).toBeVisible();
    expect(within(gate).getByText('2.8 km from the centre')).toBeVisible();

    const beach = screen.getByRole('heading', { level: 3, name: 'Konyaaltı Beach' }).closest('li')!;
    expect(within(beach).getByText('13 km from the centre')).toBeVisible();
  });

  it('shows no description line when the source gave none', () => {
    renderSection([MUSEUM]);

    const card = screen.getByRole('heading', { level: 3, name: 'Antalya Museum' }).closest('li')!;
    expect(
      within(card)
        .getAllByText(/./)
        .map((node) => node.textContent),
    ).not.toContain('null');
    expect(card.querySelectorAll('p')).toHaveLength(2);
  });

  it('shows no rating, score or price anywhere', () => {
    renderSection([GATE, MUSEUM, BEACH]);

    expect(screen.queryByText(/rated|stars?|score|reviews?|[€$£]/i)).toBeNull();
  });

  it('links to Wikipedia in a new tab, safely, and says so to a screen reader', () => {
    renderSection([GATE, MUSEUM]);

    const link = screen.getByRole('link', { name: /Read more about Hadrian's Gate on Wikipedia/ });
    expect(link).toHaveAttribute('href', 'https://en.wikipedia.org/wiki/Hadrian%27s_Gate');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link.getAttribute('rel')).toContain('noopener');
    expect(link).toHaveAccessibleName(/\(opens in a new tab\)/);

    // A place with no article has no "Read more" - not a dead link.
    expect(screen.getAllByRole('link', { name: /Read more/ })).toHaveLength(1);
  });

  it('serves photographs from our own origin, and gives an unpictured place a tile, not a picture', () => {
    const { container } = renderSection([GATE, MUSEUM]);

    const images = container.querySelectorAll('img');
    expect(images).toHaveLength(1);
    expect(images[0]!.getAttribute('src')).toMatch(/^\/api\/places\/image\?/);
    expect(images[0]!.getAttribute('srcset')).not.toMatch(/https?:/);
    expect(images[0]!.getAttribute('alt')).toBe('');
    expect(images[0]!.getAttribute('loading')).toBe('lazy');
  });

  it('has filter links for the groups that have places, with the current one marked', () => {
    renderSection([GATE, MUSEUM, BEACH], 'museums');

    const filters = screen.getByRole('navigation', { name: 'Filter things to do by kind' });
    const links = within(filters).getAllByRole('link');
    expect(links.map((link) => link.textContent)).toEqual([
      'All',
      'Sights1',
      'Museums1',
      'Outdoors1',
    ]);

    expect(within(filters).getByRole('link', { name: /Museums/ })).toHaveAttribute(
      'aria-current',
      'true',
    );
    expect(within(filters).getByRole('link', { name: /Museums/ })).toHaveAttribute(
      'href',
      '?kind=museums#things-heading',
    );
    expect(within(filters).getByRole('link', { name: 'All' })).not.toHaveAttribute('aria-current');
    expect(within(filters).queryByRole('link', { name: /Culture/ })).toBeNull();
  });

  it('shows only the chosen group, and everything when the group has nothing in it', () => {
    const { unmount } = renderSection([GATE, MUSEUM, BEACH], 'museums');
    expect(screen.getByText('1 place')).toBeVisible();
    expect(screen.queryByRole('heading', { name: "Hadrian's Gate" })).toBeNull();
    unmount();

    renderSection([GATE, MUSEUM, BEACH], 'food');
    expect(screen.getByText('3 places')).toBeVisible();
    expect(screen.getByRole('link', { name: 'All' })).toHaveAttribute('aria-current', 'true');
  });

  it('shows at most 30, and counts what it shows', () => {
    const many = Array.from({ length: 45 }, (_, index) => thing({ id: `Q${index + 10}` }));
    renderSection(many);

    expect(screen.getAllByRole('heading', { level: 3 })).toHaveLength(30);
    expect(screen.getByText('30 places')).toBeVisible();
  });

  it('names its sources, and credits each photograph with author and licence', () => {
    renderSection([GATE, MUSEUM], null, {
      credits: {
        'Hadrian Gate.jpg': {
          author: 'Jane Doe',
          licence: 'CC BY-SA 4.0',
          pageUrl: 'https://commons.wikimedia.org/wiki/File:Hadrian_Gate.jpg',
        },
      },
    });

    expect(
      screen.getByText(
        'Places from Wikidata (CC0); photographs from Wikimedia Commons, credited below.',
      ),
    ).toBeVisible();

    const credits = screen.getByText('Photograph credits').closest('details')!;
    expect(within(credits).getByText(/Jane Doe, CC BY-SA 4\.0/)).toBeInTheDocument();
    expect(
      within(credits).getByRole('link', { name: /File page for Hadrian's Gate/ }),
    ).toHaveAttribute('href', 'https://commons.wikimedia.org/wiki/File:Hadrian_Gate.jpg');
  });

  it('does not make up a credit it was not given', () => {
    renderSection([GATE]);

    const credits = screen.getByText('Photograph credits').closest('details')!;
    expect(within(credits).getByText(/author not stated, licence not stated/)).toBeInTheDocument();
    expect(within(credits).getByRole('link', { name: /File page/ })).toHaveAttribute(
      'href',
      'https://commons.wikimedia.org/wiki/File:Hadrian%20Gate.jpg',
    );
  });

  it('has no credits disclosure when no place has a photograph', () => {
    renderSection([MUSEUM]);

    expect(screen.queryByText('Photograph credits')).toBeNull();
  });

  it('says plainly when the places are samples', () => {
    renderSection([MUSEUM], null, { sample: true });

    expect(screen.getByText(/samples for demonstration/)).toBeVisible();
  });

  it('offers "Add to my plan" on each card only to somebody signed in', () => {
    const { unmount } = renderSection([GATE, MUSEUM]);
    expect(screen.queryByRole('button', { name: /Add to my plan/ })).toBeNull();
    unmount();

    render(
      <ThingsToDoSection
        outcome={outcome([GATE, MUSEUM])}
        city="Antalya"
        hrefFor={hrefFor}
        kind={null}
        planTrips={[{ id: 't1', name: 'Lisbon' }]}
      />,
    );
    expect(screen.getAllByRole('button', { name: /Add to my plan/ })).toHaveLength(2);
    // Thirty identical buttons are not thirty answers: each names its place.
    expect(screen.getByRole('button', { name: /Add to my plan \(Hadrian's Gate\)/ })).toBeVisible();
  });
});

describe('ThingsToDoSkeleton', () => {
  it('keeps the heading and announces the wait once', () => {
    render(<ThingsToDoSkeleton city="Antalya" />);

    expect(
      screen.getByRole('heading', { level: 2, name: 'Things to do in Antalya' }),
    ).toBeVisible();
    expect(screen.getByRole('status', { name: 'Loading things to do' })).toBeInTheDocument();
  });
});
