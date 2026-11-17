import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const push = vi.fn();
let query = '';
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
  useSearchParams: () => new URLSearchParams(query),
}));
vi.mock('@/components/discovery/stage-store', () => ({ setStagePending: vi.fn() }));

import { PartWeightsControl } from './part-weights';

const NORMAL = { flights: 1, stay: 1, activities: 1, transfers: 1 };

describe('PartWeightsControl', () => {
  beforeEach(() => {
    push.mockClear();
    query = '';
  });

  it('is one named group with four sliders that read out words', () => {
    render(<PartWeightsControl values={{ ...NORMAL, stay: 2 }} />);
    expect(screen.getByRole('group', { name: 'What matters most' })).toBeTruthy();
    expect(screen.getAllByRole('slider')).toHaveLength(4);
    expect(screen.getByRole('slider', { name: 'Stay' }).getAttribute('aria-valuetext')).toBe(
      'most',
    );
    expect(screen.getByRole('slider', { name: 'Flights' }).getAttribute('aria-valuetext')).toBe(
      'normal',
    );
  });

  it('offers no reset while everything is normal', () => {
    render(<PartWeightsControl values={NORMAL} />);
    expect(screen.queryByRole('button', { name: /reset/i })).toBeNull();
  });

  it('resets every weight in one navigation', async () => {
    query = 'to=LIS&wFlights=0&wStay=2';
    render(<PartWeightsControl values={{ ...NORMAL, flights: 0, stay: 2 }} />);
    await userEvent.click(screen.getByRole('button', { name: /reset/i }));
    expect(push).toHaveBeenCalledTimes(1);
    const url = String(push.mock.calls[0]?.[0]);
    expect(url).toContain('to=LIS');
    expect(url).not.toContain('wFlights');
    expect(url).not.toContain('wStay');
    expect(screen.getByRole('slider', { name: 'Flights' }).getAttribute('aria-valuetext')).toBe(
      'normal',
    );
  });

  it('applies a slider on release, not while dragging', () => {
    render(<PartWeightsControl values={NORMAL} />);
    const slider = screen.getByRole('slider', { name: 'Activities' });
    fireEvent.change(slider, { target: { value: '1.5' } });
    expect(push).not.toHaveBeenCalled();
    fireEvent.pointerUp(slider);
    expect(String(push.mock.calls[0]?.[0])).toContain('wActivities=1.5');
  });
});
