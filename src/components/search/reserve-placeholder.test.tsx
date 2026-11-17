import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ReservePlaceholder } from './reserve-placeholder';

describe('ReservePlaceholder', () => {
  it('renders both buttons disabled, with the plain-words line', () => {
    render(<ReservePlaceholder />);
    const reserve = screen.getByRole('button', { name: 'Reserve this trip' });
    const pay = screen.getByRole('button', { name: 'Payments are not switched on yet' });
    expect(reserve).toBeDisabled();
    expect(pay).toBeDisabled();
    expect(reserve).not.toHaveAttribute('aria-disabled');
    expect(
      screen.getByText(
        'Booking and payment are not switched on yet. You can see the price and check it with the hotel.',
      ),
    ).toBeInTheDocument();
  });
});
