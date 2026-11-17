import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const mocks = vi.hoisted(() => ({
  action: vi.fn(),
  query: 'checkIn=2027-03-10&checkOut=2027-03-13&adults=2',
}));

vi.mock('@/app/actions/liteapi-check-price', () => ({ checkPriceAction: mocks.action }));
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(mocks.query),
}));

import { CheckPrice } from './check-price';

const rate = {
  id: 'liteapi:lp1:offer-1',
  providerRateId: 'offer-1',
  roomName: 'Double room',
  board: 'breakfast' as const,
  cancellation: { refundable: true, deadline: null, description: null },
  source: { providerId: 'liteapi' },
};

beforeEach(() => {
  mocks.action.mockReset();
  mocks.query = 'checkIn=2027-03-10&checkOut=2027-03-13&adults=2';
});

describe('CheckPrice', () => {
  it('shows the price, the taxes and when it was checked', async () => {
    mocks.action.mockResolvedValue({
      status: 'ok',
      check: {
        total: { amount: 31250, currency: 'EUR' },
        taxesIncluded: { amount: 2000, currency: 'EUR' },
        payableAtHotel: { amount: 600, currency: 'EUR' },
        checkedAt: '2027-01-10T09:30:00.000Z',
        changed: false,
        testPrices: false,
      },
    });
    render(<CheckPrice rate={rate} />);

    fireEvent.click(screen.getByRole('button', { name: 'Check this price' }));

    await waitFor(() => expect(screen.getByText(/Current price/)).toBeTruthy());
    expect(screen.getByText(/Includes taxes/)).toBeTruthy();
    expect(screen.getByText(/Payable at the hotel/)).toBeTruthy();
    expect(screen.getByText('Checked at 09:30 UTC')).toBeTruthy();
    expect(mocks.action).toHaveBeenCalledWith(
      expect.objectContaining({ hotelId: 'lp1', checkIn: '2027-03-10', adults: 2 }),
    );
  });

  it('shows the limit message in a live region', async () => {
    mocks.action.mockResolvedValue({
      status: 'limited',
      message: 'You have used your 5 price checks.',
    });
    const { container } = render(<CheckPrice rate={rate} />);

    fireEvent.click(screen.getByRole('button', { name: 'Check this price' }));

    const message = await screen.findByText('You have used your 5 price checks.');
    expect(message.closest('[aria-live="polite"]')).toBe(container.querySelector('[aria-live]'));
  });

  it('shows Guest details and Pay as disabled, with the payments wording', () => {
    render(<CheckPrice rate={rate} showSteps />);

    expect(
      (screen.getByRole('button', { name: /Guest details/ }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect((screen.getByRole('button', { name: /Pay/ }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('Payments are not switched on yet')).toBeTruthy();
    expect(mocks.action).not.toHaveBeenCalled();
  });

  it('renders nothing for another provider or without dates', () => {
    const other = render(<CheckPrice rate={{ ...rate, source: { providerId: 'mock' } }} />);
    expect(other.container.textContent).toBe('');

    mocks.query = '';
    const noDates = render(<CheckPrice rate={rate} />);
    expect(noDates.container.textContent).toBe('');
  });
});
