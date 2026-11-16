import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ThingsToDoOutcome } from '@/discovery/things-to-do';
import type { ThingKind, ThingToDo } from '@/providers/types';
import { PlacesProvider } from './places-context';
import { ThingsToDoSection, ThingsToDoSkeleton } from './things-to-do-section';

vi.mock('@/app/actions/trips', () => ({ addToMyPlanAction: vi.fn() }));

/**
 * What a reader is told: roles, names and text, never class names.
 *
 * The rules defended are the product's. A card has a photograph or it is not a
 * card; nothing is scored; a link that leaves the site says so; the current
 * filter is announced; a place opens a sheet; and nothing renders when there is
 * no real list to show.
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

function renderSection(
  things: ThingToDo[],
  kind: ThingKind | null = null,
  extra = {},
  planTrips: { id: string; name: string }[] | null = null,
) {
  const result = outcome(things, extra);

  return render(
    <PlacesProvider
      things={result.things}
      credits={result.credits}
      city="Antalya"
      centre={[30.7, 36.9]}
      planTrips={planTrips}
      initialPlaceId={null}
    >
      <ThingsToDoSection outcome={result} city="Antalya" hrefFor={hrefFor} kind={kind} />
    </PlacesProvider>,
  );
}

const PICTURED = (id: string, name: string) => thing({ id, name, imageFile: `${name}.jpg` });

describe('ThingsToDoSection', () => {
  it('names the city and counts the places', () => {
    renderSection([GATE, MUSEUM, BEACH]);

    expect(
      screen.getByRole('heading', { level: 2, name: 'Things to do in Antalya' }),
    ).toBeVisible();
    expect(screen.getByText('3 places')).toBeVisible();
  });

  it('says "1 place" for one, and nothing at all for none', () => {
    const { unmount } = renderSection([GATE]);
    expect(screen.getByText('1 place')).toBeVisible();
    unmount();

    const empty = renderSection([]);
    expect(screen.queryByRole('heading', { level: 2 })).toBeNull();
    expect(empty.container.querySelector('section')).toBeNull();
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

  it('makes a card of a place with a photograph: its kind, one-line description and distance', () => {
    renderSection([GATE, MUSEUM, BEACH]);

    const gate = screen.getByRole('heading', { level: 3, name: "Hadrian's Gate" }).closest('li')!;
    expect(within(gate).getByText('Sights')).toBeVisible();
    // The source writes a phrase; a card starts a sentence.
    expect(within(gate).getByText('Triumphal arch in Antalya')).toBeVisible();
    expect(within(gate).getByText('2.8 km from the centre')).toBeVisible();
  });

  it('puts a place with no photograph in "More places", never in the grid as an empty tile', () => {
    renderSection([GATE, MUSEUM, BEACH]);

    const more = screen.getByRole('heading', { level: 3, name: 'More places' }).parentElement!;
    expect(within(more).getByRole('button', { name: /Antalya Museum/ })).toBeVisible();
    expect(within(more).getByText('Museums')).toBeVisible();
    expect(within(more).queryByRole('img')).toBeNull();
    // Only the pictured place is a card.
    expect(screen.getAllByRole('heading', { level: 3 }).map((node) => node.textContent)).toEqual([
      "Hadrian's Gate",
      'More places',
    ]);
  });

  it('calls the list "Places" when none has a photograph', () => {
    renderSection([MUSEUM, BEACH]);

    expect(screen.getByRole('heading', { level: 3, name: 'Places' })).toBeVisible();
    expect(screen.queryByRole('heading', { name: 'More places' })).toBeNull();
  });

  it('shows no rating, score or price anywhere', () => {
    renderSection([GATE, MUSEUM, BEACH]);

    expect(screen.queryByText(/rated|stars?|score|reviews?|[€$£]/i)).toBeNull();
  });

  it('serves photographs from our own origin, with no alt text because the name is beside them', () => {
    const { container } = renderSection([GATE, MUSEUM]);

    const images = container.querySelectorAll('img');
    expect(images).toHaveLength(1);
    expect(images[0]!.getAttribute('src')).toMatch(/^\/api\/places\/image\?/);
    expect(images[0]!.getAttribute('srcset')).not.toMatch(/https?:/);
    expect(images[0]!.getAttribute('alt')).toBe('');
    expect(images[0]!.getAttribute('loading')).toBe('lazy');
  });

  it('opens a detail sheet for a place, with the Wikipedia link that leaves the site safely', async () => {
    const user = userEvent.setup();
    renderSection([GATE, MUSEUM]);

    await user.click(screen.getByRole('button', { name: "Hadrian's Gate" }));

    const sheet = await screen.findByRole('dialog', { name: "Hadrian's Gate" });
    const link = within(sheet).getByRole('link', { name: /Read on Wikipedia/ });
    expect(link).toHaveAttribute('href', 'https://en.wikipedia.org/wiki/Hadrian%27s_Gate');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link.getAttribute('rel')).toContain('noopener');
    expect(link).toHaveAccessibleName(/\(opens in a new tab\)/);
    expect(within(sheet).getByText('2.8 km from the centre')).toBeVisible();
    expect(new URL(window.location.href).searchParams.get('place')).toBe('Q1');

    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(new URL(window.location.href).searchParams.has('place')).toBe(false);
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

  it('filters in place when a chip is chosen, and keeps the address in step', async () => {
    const user = userEvent.setup();
    renderSection([GATE, MUSEUM, BEACH]);

    await user.click(screen.getByRole('link', { name: /^Museums/ }));

    await waitFor(() => expect(screen.getByText('1 place')).toBeVisible());
    expect(screen.getByRole('link', { name: /^Museums/ })).toHaveAttribute('aria-current', 'true');
    expect(screen.queryByRole('heading', { name: "Hadrian's Gate" })).toBeNull();
    expect(window.location.search).toBe('?kind=museums');
  });

  it('shows at most 30, and counts what it shows', () => {
    const many = Array.from({ length: 45 }, (_, index) =>
      PICTURED(`Q${index + 10}`, `Spot ${index}`),
    );
    renderSection(many);

    // Thirty cards, and no "More places" heading because every one has a picture.
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

  it('offers "Add to my plan" in the sheet only to somebody signed in', async () => {
    const user = userEvent.setup();
    const { unmount } = renderSection([GATE, MUSEUM]);
    await user.click(screen.getByRole('button', { name: "Hadrian's Gate" }));
    const plain = await screen.findByRole('dialog');
    expect(within(plain).queryByRole('button', { name: /Add to my plan/ })).toBeNull();
    unmount();

    renderSection([GATE, MUSEUM], null, {}, [{ id: 't1', name: 'Lisbon' }]);
    await user.click(screen.getByRole('button', { name: "Hadrian's Gate" }));
    const signedIn = await screen.findByRole('dialog');
    // The button names its place, so it is not one of thirty identical answers.
    expect(
      within(signedIn).getByRole('button', { name: /Add to my plan \(Hadrian's Gate\)/ }),
    ).toBeVisible();
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
