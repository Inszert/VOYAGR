// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { StayResultRow } from './stay-result-row';
import type { StayRow } from './stay-rows';

const base: StayRow = {
  id: 'stay:a',
  name: 'Hotel Aurora',
  kind: 'hotel',
  stars: 4,
  address: 'Main Street 1',
  latitude: 0,
  longitude: 0,
  distanceMetres: 500,
  distanceLabel: '0.5 km from the centre',
  price: { amount: 45000, currency: 'EUR' },
  priceLabel: '€450.00 total · 3 nights',
  photo: null,
  rate: {
    room: 'Double room',
    board: 'Breakfast included',
    cancellation: 'Free cancellation',
    perNight: { amount: 15000, currency: 'EUR' },
    taxLines: [
      'Includes taxes (€20.00)',
      'Payable at the hotel: €12.00 (not part of the price shown)',
    ],
  },
  link: { kind: 'compare', href: '/stays/a', host: null },
};

describe('StayResultRow', () => {
  it('shows the hotel as a heading with the total and a link to its page', () => {
    render(<StayResultRow row={base} hotelHref="/stays/a" />);

    expect(screen.getByRole('heading', { level: 3, name: 'Hotel Aurora' })).toBeTruthy();
    expect(screen.getByText('€450.00 total · 3 nights')).toBeTruthy();
    expect(screen.getByRole('link', { name: /Hotel Aurora/ }).getAttribute('href')).toBe(
      '/stays/a',
    );
    expect(screen.getByText('Free cancellation')).toBeTruthy();
  });

  it('keeps the payable-at-the-hotel amount apart from the headline price', () => {
    render(<StayResultRow row={base} hotelHref="/stays/a" />);

    const payable = screen.getByText('Payable at the hotel: €12.00 (not part of the price shown)');
    const headline = screen.getByText('€450.00 total · 3 nights');

    expect(payable).not.toBe(headline);
    expect(headline.textContent).not.toContain('Payable');
    expect(payable.textContent).not.toContain('450');
  });

  it('says Test price only when flagged as sandbox', () => {
    const { rerender } = render(<StayResultRow row={base} hotelHref="/stays/a" />);
    expect(screen.queryByText('Test price')).toBeNull();

    rerender(<StayResultRow row={base} hotelHref="/stays/a" sandbox />);
    expect(screen.getByText('Test price')).toBeTruthy();
  });

  it('says cheapest and selected in words', () => {
    render(<StayResultRow row={base} hotelHref="/stays/a" cheapest selected />);

    expect(screen.getByText('Cheapest')).toBeTruthy();
    expect(screen.getByText('Selected')).toBeTruthy();
  });

  it('offers an outbound check for an unpriced row', () => {
    const unpriced: StayRow = {
      ...base,
      price: null,
      priceLabel: null,
      rate: null,
      link: { kind: 'partner', href: 'https://partner.example/h', host: 'partner.example' },
    };
    render(<StayResultRow row={unpriced} hotelHref="/stays/a" />);

    expect(screen.getByText('No stored price')).toBeTruthy();
    const link = screen.getByRole('link', {
      name: 'See price on partner.example (opens in a new tab)',
    });
    expect(link.getAttribute('href')).toBe('https://partner.example/h');
    expect(link.getAttribute('target')).toBe('_blank');
  });
});
