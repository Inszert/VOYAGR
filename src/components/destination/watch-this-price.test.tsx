import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { WatchThisPrice } from './plan-panel-controls';

vi.mock('next/navigation', () => ({
  usePathname: () => '/destinations/AYT',
  useRouter: () => ({ replace: vi.fn() }),
}));

const props = { query: 'origins=LHR&destinations=AYT', name: 'LHR to Antalya' };

describe('WatchThisPrice', () => {
  it('sends a signed-out visitor to sign in', () => {
    render(<WatchThisPrice {...props} signedIn={false} action={vi.fn()} />);
    expect(screen.getByRole('link', { name: /sign in to watch this price/i })).toHaveAttribute(
      'href',
      '/sign-in',
    );
  });

  it('watches the search and says so in words', async () => {
    const action = vi.fn(async (_previous: { saved?: boolean }, _form: FormData) => ({
      saved: true,
    }));
    render(<WatchThisPrice {...props} signedIn action={action} />);

    await userEvent.click(screen.getByRole('button', { name: 'Watch this price' }));

    expect(await screen.findByRole('status')).toHaveTextContent(
      'We are watching this trip. We will tell you if the price drops.',
    );
    expect(screen.getByRole('link', { name: /your watches/i })).toHaveAttribute('href', '/watches');
    const form = action.mock.calls[0]?.[1] as FormData;
    expect(form.get('query')).toBe(props.query);
    expect(form.get('name')).toBe(props.name);
  });

  it('shows the plan limit message the action returns', async () => {
    const message = 'Your plan watches 1 trips at once. Pause one to watch another.';
    render(<WatchThisPrice {...props} signedIn action={vi.fn(async () => ({ error: message }))} />);

    await userEvent.click(screen.getByRole('button', { name: 'Watch this price' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(message);
    expect(screen.getByRole('button', { name: 'Watch this price' })).toBeEnabled();
  });
});
