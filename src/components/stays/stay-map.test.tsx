// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { StayMap } from './stay-map';
import type { StayRow } from './stay-rows';

// jsdom has no WebGL, so MapLibre is replaced by a stand-in that records what
// the component asks of it: the style it is given and a marker per pin.
const styles: unknown[] = [];
vi.mock('maplibre-gl', () => {
  class FakeMap {
    constructor(options: { style: unknown }) {
      styles.push(options.style);
    }
    getCanvas() {
      return document.createElement('canvas');
    }
    addControl() {}
    once() {}
    on() {}
    remove() {}
    project() {
      return { x: 0, y: 0 };
    }
  }
  class FakeMarker {
    constructor(private readonly options: { element: HTMLElement }) {}
    setLngLat() {
      return this;
    }
    addTo(_map: unknown) {
      document.body.append(this.options.element);
      return this;
    }
    remove() {
      this.options.element.remove();
    }
  }
  class NavigationControl {}
  return {
    default: {},
    Map: FakeMap,
    Marker: FakeMarker,
    NavigationControl,
    setWorkerUrl() {},
    getVersion: () => 'test',
  };
});

function row(id: string, name: string, east: number): StayRow {
  return {
    id,
    name,
    kind: 'Hotel',
    stars: 4,
    address: null,
    latitude: 38.72,
    longitude: -9.14 + east,
    distanceMetres: 1000,
    distanceLabel: '1 km from centre',
    price: null,
    priceLabel: null,
    photo: null,
    link: null,
  } as unknown as StayRow;
}

const ROWS = [
  row('a', 'Hotel Alfama', 0),
  row('b', 'Hotel Baixa', 0.01),
  row('c', 'Hotel Chiado', 0.02),
];

describe('StayMap', () => {
  it('draws on OpenStreetMap tiles and always shows the credit line', async () => {
    render(
      <StayMap
        rows={ROWS}
        centre={{ latitude: 38.72, longitude: -9.14 }}
        area={{ south: 38.7, west: -9.2, north: 38.75, east: -9.1 }}
        city="Lisbon"
        activeId={null}
        highlightedId={null}
        selectedId={null}
        onActivate={() => {}}
        onSelect={() => {}}
      />,
    );

    const credit = screen.getByRole('link', { name: '© OpenStreetMap contributors' });
    expect(credit.getAttribute('href')).toBe('https://www.openstreetmap.org/copyright');
    expect(
      screen.getByRole('region', { name: /street map of places to stay in Lisbon/i }),
    ).toBeTruthy();

    await waitFor(() => expect(styles).toHaveLength(1));
    expect(JSON.stringify(styles[0])).toContain('tile.openstreetmap.org');
  });

  it('has one pin button per hotel, named after it', async () => {
    render(
      <StayMap
        rows={ROWS}
        centre={{ latitude: 38.72, longitude: -9.14 }}
        area={{ south: 38.7, west: -9.2, north: 38.75, east: -9.1 }}
        city="Lisbon"
        activeId={null}
        highlightedId={null}
        selectedId={null}
        onActivate={() => {}}
        onSelect={() => {}}
      />,
    );

    await waitFor(() =>
      expect(document.querySelectorAll('button.voyagr-stay-pin')).toHaveLength(3),
    );
    for (const hotel of ROWS) {
      expect(screen.getByRole('button', { name: new RegExp(hotel.name) })).toBeTruthy();
    }
  });
});
