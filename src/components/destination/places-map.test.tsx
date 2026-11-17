// @vitest-environment jsdom
import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ThingToDo } from '@/providers/types';
import { PlacesMap, dotRadius, layoutPlaces } from './places-map';

const CENTRE = [33.63, 34.92] as const;

function place(id: string, name: string, east: number, notability: number): ThingToDo {
  return {
    id,
    providerId: 'wikidata',
    name,
    kind: 'beaches',
    description: null,
    latitude: CENTRE[1] + 0.005,
    longitude: CENTRE[0] + east,
    distanceFromCentreMetres: 1000,
    notability,
    wikipediaUrl: null,
    imageFile: null,
  };
}

const PLACES = [place('Q1', 'Finikoudes', 0.01, 12), place('Q2', 'Mckenzie', 0.02, 3)];

describe('dotRadius', () => {
  it('grows with the sitelink count and stays in range', () => {
    expect(dotRadius(3, 3, 12)).toBeLessThan(dotRadius(12, 3, 12));
    expect(dotRadius(1, 3, 12)).toBe(dotRadius(3, 3, 12));
    expect(dotRadius(5, 5, 5)).toBeGreaterThan(0);
  });
});

describe('PlacesMap', () => {
  it('stays hidden from assistive technology', () => {
    const { container } = render(<PlacesMap places={PLACES} centre={CENTRE} />);

    expect(container.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('names the centre, labels rings in kilometres, and carries a legend in words', () => {
    const { container } = render(<PlacesMap places={PLACES} centre={CENTRE} />);
    const text = container.textContent ?? '';

    expect(text).toContain('City centre');
    expect(text).toMatch(/\d(\.\d)? km from centre/);
    expect(text).toContain('Each dot is a place');
    expect(text).toContain('Dashed rings show straight-line distance');
    expect(layoutPlaces(PLACES, CENTRE).rings.length).toBeGreaterThan(0);
  });

  it('sizes the better-covered place larger', () => {
    const { container } = render(<PlacesMap places={PLACES} centre={CENTRE} />);
    const radius = (id: string) =>
      Number(container.querySelector(`[data-place-dot="${id}"] .voyagr-dot`)?.getAttribute('r'));

    expect(radius('Q1')).toBeGreaterThan(radius('Q2'));
  });

  it('names and rings the place a card points at, and reports hover back', () => {
    const onActive = vi.fn();
    const { container } = render(
      <PlacesMap places={PLACES} centre={CENTRE} activeId="Q2" onActive={onActive} />,
    );

    expect(container.querySelector('[data-place-label]')?.textContent).toBe('Mckenzie');
    expect(container.querySelector('[data-place-distance]')?.textContent).toMatch(/km from centre/);
    expect(container.querySelector('[data-place-line]')).not.toBeNull();

    fireEvent.pointerEnter(container.querySelector('[data-place-dot="Q1"]')!);
    expect(onActive).toHaveBeenCalledWith('Q1');
  });

  it('drops the legend and the label for the sheet locator', () => {
    const { container } = render(<PlacesMap places={PLACES} centre={CENTRE} focusId="Q1" />);

    expect(container.querySelector('[data-legend]')).toBeNull();
    expect(container.querySelector('[data-place-label]')).toBeNull();
  });
});
