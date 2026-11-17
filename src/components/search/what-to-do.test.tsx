// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { ThingToDo } from '@/providers/types';
import { WhatToDoView } from './what-to-do';

const PLACE: ThingToDo = {
  id: 'Q1',
  providerId: 'wikidata',
  name: 'Cloud Gate',
  kind: 'sights',
  description: 'sculpture in Millennium Park',
  latitude: 41.88,
  longitude: -87.62,
  distanceFromCentreMetres: 1200,
  notability: 40,
  wikipediaUrl: null,
  imageFile: null,
};

const ok = (things: ThingToDo[]) =>
  ({ status: 'ok', things, credits: {}, sample: false, ageMs: 0 }) as const;

describe('WhatToDoView', () => {
  it('opens to the real places and a link to the rest', () => {
    render(
      <WhatToDoView outcome={ok([PLACE])} city="Chicago" destinationHref="/destinations/ORD" />,
    );

    expect(screen.getByText('What to do in Chicago')).toBeTruthy();
    expect(screen.getByText('Cloud Gate')).toBeTruthy();
    expect(
      screen.getByRole('link', { name: /everything to do in Chicago/ }).getAttribute('href'),
    ).toBe('/destinations/ORD#things');
  });

  it.each([
    [ok([]), /no sights, museums or beaches listed for Chicago/],
    [{ status: 'unavailable' } as const, /did not answer/],
    [{ status: 'absent' } as const, /not switched on/],
    [null, /do not have a position for Chicago/],
  ])('says in words why there is nothing to list', (outcome, words) => {
    render(<WhatToDoView outcome={outcome} city="Chicago" />);

    expect(screen.getByText(words)).toBeTruthy();
  });
});
