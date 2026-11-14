import { describe, expect, it } from 'vitest';
import { money } from '@/core/money';
import {
  MAX_ALERT_DESTINATIONS,
  parseAlertPreferences,
  type AlertPreferencesFormValues,
} from './alert-preferences';

const BLANK: AlertPreferencesFormValues = {
  homeAirport: '',
  destinations: '',
  budget: '',
  currency: 'EUR',
  earliestDeparture: '',
  latestDeparture: '',
  priceDropAlerts: false,
};

const parse = (overrides: Partial<AlertPreferencesFormValues>) =>
  parseAlertPreferences({ ...BLANK, ...overrides });

describe('parseAlertPreferences', () => {
  it('accepts an empty form: nothing chosen', () => {
    expect(parse({})).toEqual({
      ok: true,
      value: {
        homeAirport: null,
        destinations: [],
        budget: null,
        earliestDeparture: null,
        latestDeparture: null,
        priceDropAlerts: false,
      },
    });
  });

  it('upper-cases and de-duplicates airports', () => {
    const result = parse({ homeAirport: ' lhr ', destinations: 'lis, fao lis' });

    expect(result.ok && result.value.homeAirport).toBe('LHR');
    expect(result.ok && result.value.destinations).toEqual(['LIS', 'FAO']);
  });

  it('rejects something that is not an airport code', () => {
    expect(parse({ homeAirport: 'LOND' }).ok).toBe(false);
    expect(parse({ homeAirport: 'L1R' }).ok).toBe(false);
    expect(parse({ destinations: 'LIS, PARIS' }).ok).toBe(false);
  });

  it('allows exactly the maximum number of destinations and refuses one more', () => {
    const codes = (n: number) =>
      Array.from(
        { length: n },
        (_, i) =>
          `A${String.fromCharCode(65 + (i % 26))}${String.fromCharCode(65 + Math.floor(i / 26))}`,
      ).join(',');

    expect(parse({ destinations: codes(MAX_ALERT_DESTINATIONS) }).ok).toBe(true);
    expect(parse({ destinations: codes(MAX_ALERT_DESTINATIONS + 1) }).ok).toBe(false);
  });

  it('turns the budget into integer minor units, never a float', () => {
    const cases: [string, number][] = [
      ['500', 50_000],
      ['500.5', 50_050],
      ['0.01', 1],
      ['19.99', 1_999],
    ];

    for (const [text, minor] of cases) {
      const result = parse({ budget: text });
      expect(result.ok && result.value.budget).toEqual(money(minor, 'EUR'));
    }
  });

  it('honours the currency exponent', () => {
    const yen = parse({ budget: '5000', currency: 'jpy' });
    expect(yen.ok && yen.value.budget).toEqual(money(5_000, 'JPY'));
  });

  it.each(['0', '-5', '1e3', 'abc', '1,000', '12.3456', '0.0'])(
    'rejects the budget %j',
    (budget) => {
      expect(parse({ budget }).ok).toBe(false);
    },
  );

  it('rejects a budget with no valid currency', () => {
    expect(parse({ budget: '100', currency: 'EU' }).ok).toBe(false);
    expect(parse({ budget: '100', currency: '' }).ok).toBe(false);
  });

  it('ignores the currency when there is no budget', () => {
    expect(parse({ budget: '', currency: 'nonsense' }).ok).toBe(true);
  });

  it('accepts a one-day window and refuses a backwards one', () => {
    expect(parse({ earliestDeparture: '2026-12-01', latestDeparture: '2026-12-01' }).ok).toBe(true);
    expect(parse({ earliestDeparture: '2026-12-02', latestDeparture: '2026-12-01' }).ok).toBe(
      false,
    );
  });

  it('accepts a window open at either end, and refuses an impossible date', () => {
    expect(parse({ earliestDeparture: '2026-12-01' }).ok).toBe(true);
    expect(parse({ latestDeparture: '2026-12-01' }).ok).toBe(true);
    expect(parse({ earliestDeparture: '2026-02-30' }).ok).toBe(false);
    expect(parse({ earliestDeparture: 'soon' }).ok).toBe(false);
  });
});
