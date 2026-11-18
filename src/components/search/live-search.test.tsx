import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { NumberStepperField } from '@/components/ui';
import { AirportInput } from './airport-input';
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

  describe('the Search button', () => {
    function renderFull(origins = 'VIE') {
      return render(
        <LiveSearchForm action="/explore" label="Change this search">
          <AirportInput
            label="From"
            name="origins"
            defaultValue={origins}
            airports={[] as never}
            required
          />
          <NumberStepperField
            label="Travellers"
            name="passengers"
            min={1}
            max={9}
            defaultValue="2"
            required
          />
        </LiveSearchForm>,
      );
    }

    it('is there, and submits with the same values Enter would use', () => {
      renderFull();
      const input = screen.getByRole('spinbutton', { name: /Travellers/ });
      // Typing alone does not search.
      fireEvent.change(input, { target: { value: '3' } });
      expect(push).not.toHaveBeenCalled();

      const button = screen.getByRole('button', { name: 'Search' });
      expect(button).toHaveProperty('type', 'submit');
      expect(button).toBeEnabled();
      fireEvent.click(button);

      expect(push).toHaveBeenCalledTimes(1);
      const query = new URLSearchParams(String(push.mock.calls[0]![0]).split('?')[1]);
      expect(query.get('passengers')).toBe('3');
      expect(query.get('origins')).toBe('VIE');
    });

    it('is disabled while a field is missing, and says which in words', () => {
      renderFull('');
      expect(screen.getByRole('button', { name: 'Search' })).toBeDisabled();
      expect(screen.getByText('Add a departure airport')).toBeVisible();
    });
  });

  describe('a picked place', () => {
    const airports = [
      { code: 'BTS', name: 'Bratislava', country: 'Slovakia', priceable: true },
      { code: 'BUD', name: 'Budapest', country: 'Hungary', priceable: true },
    ] as never;

    function renderPlaces() {
      return render(
        <LiveSearchForm action="/explore" label="Change this search">
          <AirportInput label="From" name="origins" defaultValue="VIE" airports={airports} />
        </LiveSearchForm>,
      );
    }

    it('starts the search at once, without the field being left', () => {
      renderPlaces();
      const field = screen.getByRole('combobox', { name: 'From' });
      field.focus();
      fireEvent.change(field, { target: { value: 'VIE, BU' } });
      fireEvent.keyDown(field, { key: 'Enter' });
      act(() => {
        vi.advanceTimersByTime(50);
      });

      expect(document.activeElement).toBe(field);
      expect(push).toHaveBeenCalledTimes(1);
      const query = new URLSearchParams(String(push.mock.calls[0]![0]).split('?')[1]);
      expect(query.get('origins')).toBe('VIE, BUD');
    });

    it('does not search while the place is only being typed', () => {
      renderPlaces();
      const field = screen.getByRole('combobox', { name: 'From' });
      field.focus();
      fireEvent.change(field, { target: { value: 'VIE, BU' } });
      act(() => {
        vi.advanceTimersByTime(2000);
      });
      expect(push).not.toHaveBeenCalled();
    });
  });
  describe('two finished places', () => {
    const airports = [
      { code: 'BUD', name: 'Budapest', country: 'Hungary', priceable: true },
      { code: 'BTS', name: 'Bratislava', country: 'Slovakia', priceable: true },
      { code: 'AYT', name: 'Antalya', country: 'Turkey', priceable: true },
      { code: 'LIS', name: 'Lisbon', country: 'Portugal', priceable: true },
    ] as never;

    function renderTrip(date = '2026-12-01') {
      return render(
        <LiveSearchForm
          action="/explore"
          label="Change this search"
          airportCodes={['BUD', 'BTS', 'AYT', 'LIS']}
        >
          <AirportInput label="From" name="origins" defaultValue="BTS" airports={airports} />
          <AirportInput label="To" name="destinations" defaultValue="AYT" airports={airports} />
          <label>
            Leaving
            <input type="date" name="departureDate" defaultValue={date} required />
          </label>
        </LiveSearchForm>,
      );
    }

    it('searches once, 400 ms after the last change, with the field still focused', () => {
      renderTrip();
      const from = screen.getByRole('combobox', { name: 'From' });
      from.focus();
      fireEvent.change(from, { target: { value: 'BUD' } });
      act(() => {
        vi.advanceTimersByTime(399);
      });
      expect(push).not.toHaveBeenCalled();
      act(() => {
        vi.advanceTimersByTime(1);
      });
      expect(push).toHaveBeenCalledTimes(1);
      const query = new URLSearchParams(String(push.mock.calls[0]![0]).split('?')[1]);
      expect(query.get('origins')).toBe('BUD');
      expect(query.get('destinations')).toBe('AYT');
    });

    it('does not search while a code is partial or not in the airport list', () => {
      renderTrip();
      const from = screen.getByRole('combobox', { name: 'From' });
      from.focus();
      fireEvent.change(from, { target: { value: 'BU' } });
      act(() => {
        vi.advanceTimersByTime(2000);
      });
      fireEvent.change(from, { target: { value: 'BUD, ZZZ' } });
      act(() => {
        vi.advanceTimersByTime(2000);
      });
      expect(push).not.toHaveBeenCalled();
    });

    it('does not search the same values twice', () => {
      renderTrip();
      const from = screen.getByRole('combobox', { name: 'From' });
      fireEvent.change(from, { target: { value: 'BUD' } });
      act(() => {
        vi.advanceTimersByTime(500);
      });
      fireEvent.change(from, { target: { value: 'BU' } });
      fireEvent.change(from, { target: { value: 'BUD' } });
      act(() => {
        vi.advanceTimersByTime(2000);
      });
      expect(push).toHaveBeenCalledTimes(1);
    });

    it('does not search while a date is missing', () => {
      renderTrip('');
      const from = screen.getByRole('combobox', { name: 'From' });
      fireEvent.change(from, { target: { value: 'BUD' } });
      act(() => {
        vi.advanceTimersByTime(2000);
      });
      expect(push).not.toHaveBeenCalled();
    });
  });
});

describe('LiveSearchForm, the shared form fields', () => {
  it('sends a changed month or trip length with the Search button, and keeps the rest', () => {
    push.mockClear();
    render(
      <LiveSearchForm action="/explore" label="Change this search">
        <input type="hidden" name="origins" value="VIE" />
        <input type="hidden" name="fDates" value="x" />
        <select aria-label="Trip length" name="tripNights" defaultValue="7">
          <option value="7">7 nights</option>
          <option value="5">5 nights</option>
        </select>
      </LiveSearchForm>,
    );

    fireEvent.change(screen.getByLabelText('Trip length'), { target: { value: '5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));

    expect(push).toHaveBeenCalledTimes(1);
    const query = new URLSearchParams(String(push.mock.calls[0]![0]).split('?')[1]);
    expect(query.get('tripNights')).toBe('5');
    expect(query.get('origins')).toBe('VIE');
    // A different length of trip is not the window that was picked on the old one.
    expect(query.has('fDates')).toBe(false);
  });
});
