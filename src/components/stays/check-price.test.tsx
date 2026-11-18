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

  it('says Test prices. in the sandbox', async () => {
    mocks.action.mockResolvedValue({
      status: 'ok',
      check: {
        total: { amount: 31250, currency: 'EUR' },
        taxesIncluded: null,
        payableAtHotel: null,
        checkedAt: '2027-01-10T09:30:00.000Z',
        changed: false,
        testPrices: true,
      },
    });
    render(<CheckPrice rate={rate} />);
    fireEvent.click(screen.getByRole('button', { name: 'Check this price' }));
    expect(await screen.findByText('Test prices.')).toBeTruthy();
    expect(screen.getByText('Taxes not stated')).toBeTruthy();
  });

  it('shows the limit message and leaves the button usable', async () => {
    mocks.action.mockResolvedValue({
      status: 'limited',
      message: 'You have used your 5 price checks.',
    });
    render(<CheckPrice rate={rate} />);

    fireEvent.click(screen.getByRole('button', { name: 'Check this price' }));

    const message = await screen.findByText('You have used your 5 price checks.');
    expect(message.closest('[role="status"]')).toBe(screen.getByRole('status'));
    expect(
      (screen.getByRole('button', { name: 'Check this price' }) as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  it('says the stored price is unchanged when the check fails', async () => {
    mocks.action.mockResolvedValue({
      status: 'failed',
      message: 'Price checks are not available.',
    });
    render(<CheckPrice rate={rate} />);

    fireEvent.click(screen.getByRole('button', { name: 'Check this price' }));

    expect(await screen.findByText('Price checks are not available.')).toBeTruthy();
    expect(screen.getByText('The stored price above is unchanged.')).toBeTruthy();
  });

  it('keeps the live region in place before and after the check', async () => {
    mocks.action.mockResolvedValue({ status: 'limited', message: 'Try later.' });
    render(<CheckPrice rate={rate} />);
    const region = screen.getByRole('status');
    expect(region.textContent).toBe('');

    fireEvent.click(screen.getByRole('button', { name: 'Check this price' }));
    await screen.findByText('Try later.');
    expect(screen.getByRole('status')).toBe(region);
    expect(screen.getAllByRole('button', { name: 'Check this price' })).toHaveLength(1);
  });

  it('renders nothing for another provider or without dates', () => {
    const other = render(<CheckPrice rate={{ ...rate, source: { providerId: 'mock' } }} />);
    expect(other.container.textContent).toBe('');

    mocks.query = '';
    const noDates = render(<CheckPrice rate={rate} />);
    expect(noDates.container.textContent).toBe('');
  });
});
