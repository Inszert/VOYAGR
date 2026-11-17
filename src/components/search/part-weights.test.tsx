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

const NORMAL = { stay: 1, transfers: 1, cost: 1, nature: 1, weather: 1, food: 1 };

describe('PartWeightsControl', () => {
  beforeEach(() => {
    push.mockClear();
    query = '';
  });

  it('is one named group with sliders in order that read out words', () => {
    render(<PartWeightsControl values={{ ...NORMAL, stay: 2 }} />);
    expect(screen.getByRole('group', { name: 'What matters most' })).toBeTruthy();
    const sliders = screen.getAllByRole('slider');
    expect(sliders).toHaveLength(6);
    expect(sliders.map((el) => el.id)).toEqual([
      'weight-stay',
      'weight-transfers',
      'weight-cost',
      'weight-nature',
      'weight-weather',
      'weight-food',
    ]);
    expect(screen.queryByRole('slider', { name: 'Flights' })).toBeNull();
    expect(screen.queryByRole('slider', { name: 'Activities' })).toBeNull();
    expect(screen.getByRole('slider', { name: 'Stay' }).getAttribute('aria-valuetext')).toBe(
      'most',
    );
    expect(screen.getByRole('slider', { name: 'Cost' }).getAttribute('aria-valuetext')).toBe(
      'normal',
    );
  });

  it('offers no reset while everything is normal', () => {
    render(<PartWeightsControl values={NORMAL} />);
    expect(screen.queryByRole('button', { name: /reset/i })).toBeNull();
  });

  it('resets every weight in one navigation', async () => {
    query = 'to=LIS&wCost=0&wStay=2';
    render(<PartWeightsControl values={{ ...NORMAL, cost: 0, stay: 2 }} />);
    await userEvent.click(screen.getByRole('button', { name: /reset/i }));
    expect(push).toHaveBeenCalledTimes(1);
    const url = String(push.mock.calls[0]?.[0]);
    expect(url).toContain('to=LIS');
    expect(url).not.toContain('wCost');
    expect(url).not.toContain('wStay');
    expect(screen.getByRole('slider', { name: 'Cost' }).getAttribute('aria-valuetext')).toBe(
      'normal',
    );
  });

  it('lists Stay, Transfers, Cost, Nature, Weather, Food by name', () => {
    render(<PartWeightsControl values={NORMAL} />);
    expect(screen.getAllByRole('slider').map((el) => el.getAttribute('name'))).toEqual([
      'wStay',
      'wTransfers',
      'wCost',
      'wNature',
      'wWeather',
      'wFood',
    ]);
    const labels = screen.getAllByRole('slider').map((el) => el.id.replace('weight-', ''));
    expect(labels).toEqual(['stay', 'transfers', 'cost', 'nature', 'weather', 'food']);
  });

  it('writes wNature and wFood on release', () => {
    render(<PartWeightsControl values={NORMAL} />);
    fireEvent.change(screen.getByRole('slider', { name: 'Nature' }), { target: { value: '2' } });
    fireEvent.pointerUp(screen.getByRole('slider', { name: 'Nature' }));
    expect(String(push.mock.calls[0]?.[0])).toContain('wNature=2');
    fireEvent.change(screen.getByRole('slider', { name: 'Food' }), { target: { value: '0' } });
    fireEvent.pointerUp(screen.getByRole('slider', { name: 'Food' }));
    expect(String(push.mock.calls[1]?.[0])).toContain('wFood=0');
  });

  it('applies a slider on release, not while dragging', () => {
    render(<PartWeightsControl values={NORMAL} />);
    const slider = screen.getByRole('slider', { name: 'Weather' });
    fireEvent.change(slider, { target: { value: '1.5' } });
    expect(push).not.toHaveBeenCalled();
    fireEvent.pointerUp(slider);
    expect(String(push.mock.calls[0]?.[0])).toContain('wWeather=1.5');
  });
});
