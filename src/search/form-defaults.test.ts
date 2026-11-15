import { describe, expect, it } from 'vitest';
import { daysBetween, isAfter } from '@/core/dates';
import { searchFormDefaults } from './form-defaults';

describe('searchFormDefaults', () => {
  it('puts every default date in the future of the injected today', () => {
    const today = '2026-11-15';
    const d = searchFormDefaults(today);

    expect(d.departureDate).toBe('2026-11-29');
    expect(d.returnDate).toBe('2026-12-06');
    for (const key of ['departureDate', 'returnDate', 'earliestDeparture', 'latestReturn']) {
      expect(isAfter(d[key]!, today)).toBe(true);
    }
  });

  it('keeps the trip and the window internally consistent', () => {
    const d = searchFormDefaults('2027-02-20');

    expect(daysBetween(d.departureDate!, d.returnDate!)).toBe(7);
    expect(isAfter(d.latestReturn!, d.returnDate!)).toBe(true);
    // Crosses a month end and a leap-free February without drifting.
    expect(d.departureDate).toBe('2027-03-06');
  });

  it('moves with the clock instead of fixing a date', () => {
    expect(searchFormDefaults('2026-01-01').departureDate).not.toBe(
      searchFormDefaults('2026-06-01').departureDate,
    );
  });

  it('keeps the non-date defaults', () => {
    const d = searchFormDefaults('2026-11-15');
    expect(d).toMatchObject({ origins: 'VIE', currency: 'EUR', passengers: '2' });
  });

  it('refuses a malformed today rather than guessing one', () => {
    expect(() => searchFormDefaults('tomorrow')).toThrow(RangeError);
  });
});
