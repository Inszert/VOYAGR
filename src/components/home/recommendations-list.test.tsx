import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import type { RecommendationView } from '@/search/recommendations';
import { RecommendationsList } from './recommendations-list';

const item = (destination: string, priceMinor: number) => ({
  destination,
  priceMinor,
  currency: 'EUR',
  departureDate: '2027-02-09',
  returnDate: '2027-02-13',
  carrier: null,
  deepLink: null,
});

const stale: RecommendationView = {
  status: 'stale',
  items: [item('OLD', 5000)],
  generatedAt: '2027-01-09T20:00:00.000Z',
  label: 'checked 16 h ago',
  refreshed: false,
  refreshFailed: null,
};
const fresh: RecommendationView = {
  status: 'fresh',
  items: [item('BCN', 8000), item('LIS', 9900)],
  generatedAt: '2027-01-10T12:00:00.000Z',
  label: 'checked less than 1 h ago',
  refreshed: true,
  refreshFailed: null,
};

describe('RecommendationsList', () => {
  it('says there is nothing to show, rather than leaving skeletons, when the refresh ends empty', async () => {
    const none: RecommendationView = {
      ...fresh,
      status: 'missing',
      items: [],
      label: 'no data yet',
    };
    render(<RecommendationsList initial={none} refresh={async () => none} />);
    expect(await screen.findByText('No recommended trips to show yet.')).toBeTruthy();
    expect(screen.getByRole('status').textContent).toContain('No recommendations yet');
  });

  it('shows the stored list at once, then replaces it, with the same row space', async () => {
    let resolve!: (view: RecommendationView) => void;
    const refresh = vi.fn(() => new Promise<RecommendationView>((r) => (resolve = r)));
    render(<RecommendationsList initial={stale} refresh={refresh} />);

    expect(screen.getByText('OLD')).toBeTruthy();
    expect(screen.getByRole('status').textContent).toContain('checked 16 h ago');
    const list = screen.getByRole('list');
    const minHeight = (list as HTMLElement).style.minHeight;
    expect(minHeight).not.toBe('');

    resolve(fresh);
    await waitFor(() => expect(screen.getByText('BCN')).toBeTruthy());
    expect(screen.queryByText('OLD')).toBeNull();
    expect((screen.getByRole('list') as HTMLElement).style.minHeight).toBe(minHeight);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('does not ask for a refresh when the list is fresh', () => {
    const refresh = vi.fn(async () => fresh);
    render(<RecommendationsList initial={fresh} refresh={refresh} />);
    expect(refresh).not.toHaveBeenCalled();
    expect(screen.getByText('BCN')).toBeTruthy();
  });

  it('keeps the stale list and says so when the refresh could not happen', async () => {
    const refresh = vi.fn(async () => ({ ...stale, refreshFailed: 'error' as const }));
    render(<RecommendationsList initial={stale} refresh={refresh} />);
    await waitFor(() =>
      expect(screen.getByRole('status').textContent).toContain('Could not refresh'),
    );
    expect(screen.getByText('OLD')).toBeTruthy();
  });
});
