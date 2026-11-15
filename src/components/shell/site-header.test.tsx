import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SiteHeader } from './site-header';

vi.mock('next/navigation', () => ({ usePathname: () => '/explore' }));

/**
 * The header's phone behaviour.
 *
 * Below 1024px the navigation is behind a button named "Menu". What is
 * defended is the contract of that sheet - it names itself, marks the current
 * page, and closes on Escape - not how it is drawn.
 */

function renderHeader() {
  return render(
    <SiteHeader
      account={<span>desktop account</span>}
      primaryAction={<a href="/sign-up">Create account</a>}
      menuAccount={<a href="/sign-in">Sign in</a>}
      menuDataSwitch={<span>data switch</span>}
    />,
  );
}

describe('the phone menu', () => {
  it('is a button named Menu that opens a labelled dialog', async () => {
    const user = userEvent.setup();
    renderHeader();

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Menu' }));

    expect(screen.getByRole('dialog', { name: 'Menu' })).toBeInTheDocument();
  });

  it('lists every place and marks the current one', async () => {
    const user = userEvent.setup();
    renderHeader();
    await user.click(screen.getByRole('button', { name: 'Menu' }));

    const dialog = screen.getByRole('dialog', { name: 'Menu' });
    for (const label of ['Discover', 'Explore', 'Stays', 'Watches', 'Trips']) {
      expect(within(dialog).getByRole('link', { name: label })).toBeInTheDocument();
    }

    expect(within(dialog).getByRole('link', { name: 'Explore' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(within(dialog).getByRole('link', { name: 'Trips' })).not.toHaveAttribute('aria-current');
    expect(within(dialog).getByText('data switch')).toBeInTheDocument();
  });

  it('closes on Escape and gives focus back to the button', async () => {
    const user = userEvent.setup();
    renderHeader();
    const button = screen.getByRole('button', { name: 'Menu' });

    await user.click(button);
    await user.keyboard('{Escape}');

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(button).toHaveFocus();
  });
});
