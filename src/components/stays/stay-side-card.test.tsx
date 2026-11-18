// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { IsoDate } from '@/core/trip/types';
import type { StayRate } from '@/core/stay/types';

vi.mock('@/app/actions/liteapi-check-price', () => ({ checkPriceAction: vi.fn() }));
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams('checkIn=2027-03-10&checkOut=2027-03-13&adults=2'),
}));

import { StaySideCard } from './stay-side-card';

const rate = {
  id: 'liteapi:lp1:offer-1',
  providerRateId: 'offer-1',
  roomName: 'Double room',
  board: 'breakfast',
  cancellation: { refundable: true, deadline: null, description: null },
  total: { amount: 30000, currency: 'EUR' },
  taxesAndFees: { amount: 2000, currency: 'EUR' },
  payableAtProperty: { amount: 600, currency: 'EUR' },
  source: { providerId: 'liteapi' },
} as unknown as StayRate;

function card(over: Partial<StayRate> = {}) {
  return render(
    <StaySideCard
      rate={{ ...rate, ...over } as StayRate}
      hotelName="Hotel Lisboa"
      checkIn={'2027-03-10' as IsoDate}
      checkOut={'2027-03-13' as IsoDate}
      nights={3}
      adults={2}
      rooms={1}
    />,
  );
}

describe('StaySideCard', () => {
  it('has its heading, the stay and the picked rate total', () => {
    card();
    expect(screen.getByRole('heading', { name: 'Your stay' })).toBeTruthy();
    expect(screen.getByText(/2027-03-10 to 2027-03-13 \(3 nights\)/)).toBeTruthy();
    expect(screen.getByText('2 adults, 1 room')).toBeTruthy();
    expect(screen.getByText(/300/)).toBeTruthy();
  });

  it('says tax in words, with the hotel-paid amount outside the price', () => {
    card();
    expect(screen.getByText(/Includes taxes/)).toBeTruthy();
    expect(screen.getByText(/not part of the price shown/)).toBeTruthy();
  });

  it('says taxes are not stated when the rate does not say', () => {
    card({ taxesAndFees: null, payableAtProperty: null });
    expect(screen.getByText('Taxes not stated')).toBeTruthy();
  });

  it('shows the steps disabled with their words, and no payment control enabled', () => {
    card();
    expect(
      (screen.getByRole('button', { name: '2. Guest details' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect((screen.getByRole('button', { name: '3. Pay' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect(screen.getByText('Payments are not switched on yet')).toBeTruthy();

    const enabled = screen
      .getAllByRole('button')
      .filter((b) => !(b as HTMLButtonElement).disabled)
      .map((b) => b.textContent);
    expect(enabled).toEqual(['Check this price']);
  });

  it('holds the check control and its live region', () => {
    card();
    expect(screen.getByRole('button', { name: 'Check this price' })).toBeTruthy();
    expect(screen.getByRole('status')).toBeTruthy();
  });
});
