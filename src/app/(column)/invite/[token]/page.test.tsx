import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

const getCurrentUser = vi.fn();
vi.mock('@/auth/current-user', () => ({ getCurrentUser: () => getCurrentUser() }));
vi.mock('@/app/actions/trips', () => ({ acceptInviteAction: vi.fn() }));

const { default: InvitePage } = await import('./page');

const TOKEN = 'A'.repeat(43);

async function show(search: Record<string, string> = {}) {
  render(
    await InvitePage({
      params: Promise.resolve({ token: TOKEN }),
      searchParams: Promise.resolve(search),
    }),
  );
}

describe('invite page', () => {
  beforeEach(() => getCurrentUser.mockReset());

  it('offers sign-in and sign-up links that return here, not a join button, when signed out', async () => {
    getCurrentUser.mockResolvedValue(null);
    await show();

    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute(
      'href',
      `/sign-in?next=/invite/${TOKEN}`,
    );
    expect(screen.getByRole('link', { name: 'Create an account' })).toHaveAttribute(
      'href',
      `/sign-up?next=/invite/${TOKEN}`,
    );
    expect(screen.queryByRole('button', { name: 'Join this trip' })).not.toBeInTheDocument();
  });

  it('offers the join button when signed in', async () => {
    getCurrentUser.mockResolvedValue({ id: 'u1' });
    await show();

    expect(screen.getByRole('button', { name: 'Join this trip' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Sign in' })).not.toBeInTheDocument();
  });

  it('says the same plain thing for any failed link', async () => {
    getCurrentUser.mockResolvedValue({ id: 'u1' });
    await show({ failed: '1' });

    expect(screen.getByRole('alert')).toHaveTextContent('This invite link is not valid any more');
  });
});
