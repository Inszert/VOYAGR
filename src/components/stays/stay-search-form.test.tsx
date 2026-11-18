import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { StayQuery } from '@/core/stay/types';
import type { IsoDate } from '@/core/trip/types';
import type { StayDatePrice } from '@/search/stays/calendar';
import { StaySearchForm } from './stay-search-form';
import { DatePriceGrid } from './date-price-grid';

const query = {
  destination: { code: null, name: 'Lisbon', position: null, radiusKm: null },
  checkIn: '2027-12-12' as IsoDate,
  checkOut: '2027-12-16' as IsoDate,
  occupancy: { adults: 2, rooms: 1 },
  currency: 'EUR',
} as unknown as StayQuery;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('StaySearchForm', () => {
  it('gives every field a real label and keeps the field names', () => {
    const { container } = render(<StaySearchForm query={query} today={'2027-01-01' as IsoDate} />);

    expect(screen.getByLabelText(/Destination/)).toHaveAttribute('name', 'destination');
    expect(screen.getByLabelText(/Check-in/)).toHaveAttribute('name', 'checkIn');
    expect(screen.getByLabelText(/Check-out/)).toHaveAttribute('name', 'checkOut');
    expect(screen.getByLabelText(/Guests/)).toHaveAttribute('name', 'adults');
    expect(screen.getByLabelText(/Rooms/)).toHaveAttribute('name', 'rooms');

    const form = container.querySelector('form')!;
    expect(form).toHaveAttribute('method', 'get');
    expect(form).toHaveAttribute('action', '/stays');
  });

  it('submits the same values as before', () => {
    const { container } = render(
      <StaySearchForm query={query} today={'2027-01-01' as IsoDate} hidden={{ with: 'flights' }} />,
    );
    expect(screen.getByRole('button', { name: 'Search stays' })).toHaveAttribute('type', 'submit');

    const data = new FormData(container.querySelector('form')!);
    expect(Object.fromEntries(data.entries())).toEqual({
      with: 'flights',
      destination: 'Lisbon',
      checkIn: '2027-12-12',
      checkOut: '2027-12-16',
      adults: '2',
      rooms: '1',
    });
  });

  it('folds into a summary on a phone, and Change search opens the form', () => {
    vi.stubGlobal('matchMedia', (q: string) => ({
      matches: q.includes('max-width'),
      media: q,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }));
    const { container } = render(<StaySearchForm query={query} today={'2027-01-01' as IsoDate} />);

    expect(screen.getByTestId('stay-search-summary')).toHaveTextContent(/Lisbon · .* · 2 guests/);
    const details = container.querySelector('details')!;
    expect(details.open).toBe(false);

    fireEvent.click(screen.getByText('Change search'));
    expect(details.open).toBe(true);
  });
});

const price = (over: Partial<StayDatePrice>): StayDatePrice => ({
  checkIn: '2027-12-12' as IsoDate,
  checkOut: '2027-12-16' as IsoDate,
  nights: 4,
  total: { amount: 40000, currency: 'EUR' },
  perNight: { amount: 10000, currency: 'EUR' },
  providerId: 'mock',
  differenceFromSelected: null,
  fractionFromSelected: null,
  cheapest: false,
  selected: false,
  ...over,
});

describe('DatePriceGrid', () => {
  const prices = [
    price({ selected: true }),
    price({
      checkIn: '2027-12-13' as IsoDate,
      checkOut: '2027-12-17' as IsoDate,
      total: null,
      perNight: null,
    }),
  ];
  const hrefFor = (p: StayDatePrice) => `/stays?checkIn=${p.checkIn}&dates=confirmed`;

  it('says so when a window has no price', () => {
    render(<DatePriceGrid prices={prices} hrefFor={hrefFor} />);
    expect(screen.getByText('No price came back for these dates')).toBeInTheDocument();
    expect(screen.getByText('Your dates')).toBeInTheDocument();
  });

  it('links the confirm button to the results step for the selected dates', () => {
    render(<DatePriceGrid prices={prices} hrefFor={hrefFor} />);
    expect(screen.getByRole('link', { name: /See places for/ })).toHaveAttribute(
      'href',
      '/stays?checkIn=2027-12-12&dates=confirmed',
    );
  });
});
