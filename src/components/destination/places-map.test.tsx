// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ThingToDo } from '@/providers/types';
import { PlacesMap, dotLabel, dotRadius } from './places-map';

// jsdom has no WebGL: MapLibre cannot start, so the map shows its failure line
// while the DOM carries every fact. That is the contract worth testing here.
vi.mock('maplibre-gl', () => {
  throw new Error('no webgl in jsdom');
});

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
  it('renders a named map region for the street map', () => {
    render(<PlacesMap places={PLACES} centre={CENTRE} />);

    expect(screen.getByRole('region', { name: 'Street map of the places' })).toBeTruthy();
  });

  it('always shows the OpenStreetMap credit line, linked to the copyright page', () => {
    render(<PlacesMap places={PLACES} centre={CENTRE} />);
    const credit = screen.getByRole('link', { name: '© OpenStreetMap contributors' });

    expect(credit.getAttribute('href')).toBe('https://www.openstreetmap.org/copyright');
  });

  it('puts every place in the DOM with its name and distance', () => {
    render(<PlacesMap places={PLACES} centre={CENTRE} />);
    const list = screen.getByRole('list', { name: 'Places on the map' });

    expect(list.querySelectorAll('li')).toHaveLength(2);
    expect(screen.getByRole('button', { name: dotLabel(PLACES[0]!) })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Mckenzie, .* km from centre/ })).toBeTruthy();
  });

  it('reports focus and selection back, so a card and its dot stay in step', () => {
    const onActive = vi.fn();
    const onSelect = vi.fn();
    render(<PlacesMap places={PLACES} centre={CENTRE} onActive={onActive} onSelect={onSelect} />);
    const button = screen.getByRole('button', { name: /Finikoudes/ });

    fireEvent.focus(button);
    expect(onActive).toHaveBeenCalledWith('Q1');
    fireEvent.click(button);
    expect(onSelect).toHaveBeenCalledWith('Q1');
  });

  it('says so, and keeps the list, when the map cannot load', async () => {
    render(<PlacesMap places={PLACES} centre={CENTRE} />);

    expect(await screen.findByRole('status')).toBeTruthy();
    expect(screen.getAllByRole('button')).toHaveLength(2);
  });

  it('explains the dots in words, except in the sheet locator', () => {
    const { container, rerender } = render(<PlacesMap places={PLACES} centre={CENTRE} />);
    expect(container.querySelector('[data-legend]')?.textContent).toContain('Each dot is a place');

    rerender(<PlacesMap places={PLACES} centre={CENTRE} focusId="Q1" />);
    expect(container.querySelector('[data-legend]')).toBeNull();
  });
});
