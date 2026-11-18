// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { stalenessLine } from '@/liteapi-snapshot/staleness';
import type { SnapshotStatus } from '@/liteapi-snapshot/read';
import { StayResults, type StayResultsProps } from './stay-results';
import type { StayRow } from './stay-rows';

vi.mock('./stay-map', () => ({ StayMap: () => <div data-testid="map" /> }));

const priced: StayRow = {
  id: 'stay:a',
  name: 'Hotel Aurora',
  kind: 'hotel',
  stars: 4,
  address: null,
  latitude: 0,
  longitude: 0,
  distanceMetres: 500,
  distanceLabel: '0.5 km from the centre',
  price: { amount: 45000, currency: 'EUR' },
  priceLabel: '€450.00 total · 3 nights',
  photo: null,
  rate: {
    room: null,
    board: 'Breakfast included',
    cancellation: 'Free cancellation',
    perNight: { amount: 15000, currency: 'EUR' },
    taxLines: [],
  },
  link: { kind: 'compare', href: '/stays?property=a', host: null },
};

const listed: StayRow = {
  ...priced,
  id: 'osm:1',
  name: 'Pension Blau',
  price: null,
  priceLabel: null,
  rate: null,
  link: { kind: 'partner', href: 'https://partner.example/h', host: 'partner.example' },
};

const status: SnapshotStatus = {
  state: 'fresh',
  observedAt: '2026-11-18T08:00:00Z',
  ageHours: 3,
  testPrices: false,
};

function props(overrides: Partial<StayResultsProps> = {}): StayResultsProps {
  return {
    rows: [listed, priced],
    nights: 3,
    city: 'Vienna',
    centre: { latitude: 0, longitude: 0 },
    area: { south: -1, west: -1, north: 1, east: 1 },
    status,
    credit: {
      attribution: 'OpenStreetMap contributors',
      licence: 'ODbL',
      retrievedAt: '2026-11-01',
      copyrightUrl: 'https://www.openstreetmap.org/copyright',
    },
    listed: true,
    ...overrides,
  };
}

describe('StayResults', () => {
  it('has one h1 with the count, nights and city, and the freshness words from stalenessLine', () => {
    render(<StayResults {...props()} />);

    expect(
      screen.getAllByRole('heading', { level: 1 }).map((heading) => heading.textContent),
    ).toEqual(['2 places for 3 nights in Vienna']);
    expect(screen.getByText(stalenessLine(status)!)).toBeTruthy();
  });

  it('lists priced places before listed ones', () => {
    render(<StayResults {...props()} />);

    const names = screen
      .getAllByRole('heading', { level: 3 })
      .map((heading) => heading.textContent);
    expect(names).toEqual(['Hotel Aurora', 'Pension Blau']);
  });

  it('says Cheapest in words on the row it is handed', () => {
    render(<StayResults {...props({ cheapestId: 'stay:a' })} />);
    expect(screen.getByText('Cheapest')).toBeTruthy();
  });

  it('offers a Map button that opens the map in a dialog', async () => {
    const { default: userEvent } = await import('@testing-library/user-event');
    render(<StayResults {...props()} />);

    await userEvent.click(screen.getByRole('button', { name: 'Map' }));
    expect(screen.getByRole('dialog', { name: 'Places to stay in Vienna' })).toBeTruthy();
    expect(screen.getByTestId('map')).toBeTruthy();
  });

  it('shows No stored price and never a figure when nothing is priced', () => {
    const missing: SnapshotStatus = {
      state: 'missing',
      observedAt: null,
      ageHours: null,
      testPrices: false,
    };
    const { container } = render(<StayResults {...props({ rows: [listed], status: missing })} />);

    expect(screen.getByRole('heading', { name: 'No stored price' })).toBeTruthy();
    expect(screen.getByText(stalenessLine(missing)!)).toBeTruthy();
    expect(container.textContent).not.toMatch(/[€$£]\s?\d/);
    expect(
      screen.getByRole('link', { name: /See price on partner\.example/ }).getAttribute('target'),
    ).toBe('_blank');
  });

  it('says Test prices in words on the status line and on priced rows', () => {
    render(<StayResults {...props({ status: { ...status, testPrices: true } })} />);

    expect(screen.getByText('Test prices.')).toBeTruthy();
    expect(screen.getByText('Test price')).toBeTruthy();
  });
});
