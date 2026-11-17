import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { NumberStepperField } from '@/components/ui';
import { LiveSearchForm, liveSearchQuery } from './live-search';

const push = vi.fn();
const search = 'origins=VIE&destinations=AYT&passengers=2&flexibility=plus-minus-3&fDates=x';
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
  useSearchParams: () => new URLSearchParams(search),
}));

/**
 * The explorer's search, applied as it is edited.
 *
 * What is defended: a change becomes an address (the search stays a URL), the
 * address carries everything else about the search unchanged, what the change
 * makes stale is dropped, and a half-finished edit does not search at all.
 */

describe('liveSearchQuery', () => {
  const base: [string, string][] = [
    ['origins', 'VIE'],
    ['destinations', 'AYT'],
    ['passengers', '3'],
    ['flexibility', 'plus-minus-3'],
    ['fDates', '2026-12-01..2026-12-08'],
    ['fDest', 'AYT'],
    ['maxBudget', '1200'],
    ['edit', '1'],
  ];

  it('keeps every other part of the search, and the narrowing a party change does not affect', () => {
    const query = new URLSearchParams(liveSearchQuery(base, new Set(['passengers'])));
    expect(query.get('passengers')).toBe('3');
    expect(query.get('maxBudget')).toBe('1200');
    expect(query.get('fDates')).toBe('2026-12-01..2026-12-08');
    expect(query.get('fDest')).toBe('AYT');
    expect(query.has('edit')).toBe(false);
  });

  it('drops a picked date when the dates change, and keeps the chosen flexibility', () => {
    const query = new URLSearchParams(liveSearchQuery(base, new Set(['departureDate'])));
    expect(query.has('fDates')).toBe(false);
    expect(query.get('fDest')).toBe('AYT');
    expect(query.get('flexibility')).toBe('plus-minus-3');
  });

  it('reads typed dates as exact dates when the search was a window or a month', () => {
    for (const flexibility of ['custom', 'month', null]) {
      const entries = base.filter(([key]) => key !== 'flexibility');
      if (flexibility) entries.push(['flexibility', flexibility]);
      const query = new URLSearchParams(liveSearchQuery(entries, new Set(['returnDate'])));
      expect(query.get('flexibility')).toBe('exact');
    }
  });

  it('drops the narrowing to a place when the places change', () => {
    const query = new URLSearchParams(liveSearchQuery(base, new Set(['destinations'])));
    expect(query.has('fDest')).toBe(false);
    expect(query.has('fDates')).toBe(false);
  });
});

describe('LiveSearchForm', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    push.mockClear();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function renderForm() {
    return render(
      <LiveSearchForm action="/explore" label="Change this search">
        <input type="hidden" name="origins" value="VIE" />
        <input type="hidden" name="flexibility" value="plus-minus-3" />
        <input type="hidden" name="fDates" value="x" />
        <NumberStepperField label="Travellers" name="passengers" min={1} max={9} defaultValue="2" />
      </LiveSearchForm>,
    );
  }

  it('applies a change of travellers without a button, as one navigation', () => {
    renderForm();
    const input = screen.getByRole('spinbutton', { name: 'Travellers' });

    fireEvent.change(input, { target: { value: '3' } });
    fireEvent.change(input, { target: { value: '4' } });
    expect(push).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(push).toHaveBeenCalledTimes(1);
    const [url, options] = push.mock.calls[0]!;
    expect(url).toMatch(/^\/explore\?/);
    const query = new URLSearchParams(String(url).split('?')[1]);
    expect(query.get('passengers')).toBe('4');
    expect(query.get('origins')).toBe('VIE');
    expect(query.get('fDates')).toBe('x');
    expect(options).toEqual({ scroll: false });
    expect(screen.getByRole('form', { name: 'Change this search' })).toBeTruthy();
  });

  it('builds a second change on the first one before the page has caught up', () => {
    render(
      <LiveSearchForm action="/explore" label="Change this search">
        <input type="hidden" name="flexibility" value="custom" />
        <label>
          Leaving
          <input type="date" name="departureDate" defaultValue="2026-12-01" />
        </label>
        <NumberStepperField label="Travellers" name="passengers" min={1} max={9} defaultValue="2" />
      </LiveSearchForm>,
    );

    fireEvent.change(screen.getByLabelText('Leaving'), { target: { value: '2026-12-04' } });
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Travellers' }), {
      target: { value: '3' },
    });
    act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(push).toHaveBeenCalledTimes(2);
    const second = new URLSearchParams(String(push.mock.calls[1]![0]).split('?')[1]);
    // The hidden field still says `custom`; the address the first change made says otherwise.
    expect(second.get('flexibility')).toBe('exact');
    expect(second.get('departureDate')).toBe('2026-12-04');
    expect(second.get('passengers')).toBe('3');
  });

  it('does nothing when nothing changed, or when a field would not submit', () => {
    renderForm();
    const input = screen.getByRole('spinbutton', { name: 'Travellers' });

    fireEvent.blur(input);
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(push).not.toHaveBeenCalled();

    fireEvent.change(input, { target: { value: '12' } });
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(push).not.toHaveBeenCalled();
  });
});
