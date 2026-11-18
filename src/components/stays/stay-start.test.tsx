// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { StayQuery } from '@/core/stay/types';
import type { IsoDate } from '@/core/trip/types';
import type { RecommendationCard } from '@/search/stays/recommendations';
import type { CoveredCity } from '@/search/stays/start-cities';
import { StayStart } from './stay-start';

const query = {
  destination: { code: null, name: null, position: null, radiusKm: null },
  checkIn: '2027-12-12' as IsoDate,
  checkOut: '2027-12-16' as IsoDate,
  occupancy: { adults: 2, children: 0, rooms: 1 },
  currency: 'EUR',
} as unknown as StayQuery;

const priced = {
  hotelKey: 'h1',
  cityCode: 'LIS',
  hasPhoto: true,
  name: 'Casa Azul',
  photoUrl: 'https://static.cupid.travel/a.jpg',
  stars: 4,
  guestRating: 8.6,
  price: {
    total: { amount: 48000, currency: 'EUR' },
    perNight: { amount: 12000, currency: 'EUR' },
    totalLabel: 'EUR 480.00',
    perNightLabel: 'EUR 120.00',
    testPrices: true,
  },
  checkIn: '2027-12-12',
  checkOut: '2027-12-16',
  observedAt: '2027-01-01T00:00:00Z',
  testPrices: true,
} as unknown as RecommendationCard;

const unpriced = {
  ...priced,
  hotelKey: 'h2',
  name: 'Quinta Velha',
  photoUrl: null,
  stars: null,
  guestRating: null,
  price: null,
  testPrices: false,
} as RecommendationCard;

const cities: CoveredCity[] = [
  {
    code: 'LIS',
    name: 'Lisbon',
    photo: '/img/destinations/LIS-768.webp',
    width: 1024,
    height: 688,
  },
  { code: 'NYC', name: 'New York', photo: null, width: null, height: null },
];

const base = { query, today: '2027-01-01' as IsoDate, cities };

describe('StayStart', () => {
  it('words stars, rating, price and the test note; each card is one link named by the hotel', () => {
    render(<StayStart {...base} cards={[priced, unpriced]} />);

    const link = screen.getByRole('link', { name: /Casa Azul/ });
    const href = link.getAttribute('href') ?? '';
    expect(href).toContain('destinationCode=LIS');
    expect(href).toContain('property=h1');
    expect(href).toContain('checkIn=2027-12-12');
    expect(href).toContain('adults=2');
    expect(screen.getByRole('heading', { level: 3, name: 'Casa Azul' })).toBeTruthy();
    expect(screen.getByText(/Four-star/)).toBeTruthy();
    expect(screen.getByText(/8\.6 out of 10/)).toBeTruthy();
    expect(screen.getByText('EUR 480.00 total')).toBeTruthy();
    expect(screen.getByText('Test prices.')).toBeTruthy();
    expect(screen.getByAltText('Photo of Casa Azul')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Cities we hold hotels for' })).toBeTruthy();
  });

  it('shows No stored price, no figure, and unknown stars and rating in words', () => {
    render(<StayStart {...base} cards={[unpriced]} />);

    const link = screen.getByRole('link', { name: /Quinta Velha/ });
    expect(link.textContent).toContain('No stored price');
    expect(link.textContent).toContain('Stars not stated');
    expect(link.textContent).toContain('No guest rating');
    expect(link.textContent).not.toMatch(/EUR/);
  });

  it('calls the city section Places to start when there are no cards, and links cities', () => {
    render(<StayStart {...base} cards={[]} />);

    expect(screen.getByRole('heading', { name: 'Places to start' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Recently priced stays' })).toBeNull();
    expect(screen.getByRole('heading', { level: 1, name: 'Find a place to stay' })).toBeTruthy();
    expect(screen.getByRole('link', { name: /Lisbon/ }).getAttribute('href')).toBe(
      '/stays?destination=LIS',
    );
    expect(screen.getByAltText('Lisbon, illustration')).toBeTruthy();
    expect(screen.getByText('NY')).toBeTruthy();
    expect(screen.getByText(/Prices here are stored, not live/)).toBeTruthy();
  });
});
