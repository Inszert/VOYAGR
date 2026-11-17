import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import EmailConfirmedPage from './page';

describe('email confirmed page', () => {
  it('says in plain words that the email is confirmed', () => {
    render(<EmailConfirmedPage />);

    expect(
      screen.getByRole('heading', { level: 1, name: 'Your email is confirmed' }),
    ).toBeInTheDocument();
  });

  it('offers the account as the primary way on', () => {
    render(<EmailConfirmedPage />);

    expect(screen.getByRole('link', { name: 'Continue to your account' })).toHaveAttribute(
      'href',
      '/account',
    );
  });

  it('offers searching for trips as the secondary way on', () => {
    render(<EmailConfirmedPage />);

    expect(screen.getByRole('link', { name: 'Search trips' })).toHaveAttribute('href', '/explore');
  });
});
