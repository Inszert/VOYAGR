import { describe, expect, it } from 'vitest';
import { money } from '@/core/money';
import { AppError } from '@/lib/errors';
import {
  assertNoInventedFigures,
  extractNumbers,
  toSearchProfile,
  validateParsedRequest,
  withFigureGuard,
} from './guardrails';
import type { ParsedTripRequest } from './types';

function validRequest(overrides: Partial<ParsedTripRequest> = {}) {
  return {
    passengers: 2,
    minNights: 4,
    maxNights: 6,
    origins: ['VIE'],
    destinationHints: ['mediterranean'],
    targetBudgetMajorUnits: 650,
    maxBudgetMajorUnits: 850,
    currency: 'EUR',
    travelStyle: 'beach',
    optimisationMode: 'best_value',
    requireDirectFlights: false,
    requireCheckedBaggage: false,
    mealsPerDay: 3,
    confidence: 0.8,
    unresolved: [],
    ...overrides,
  };
}

describe('validateParsedRequest', () => {
  it('accepts a well-formed request', () => {
    expect(validateParsedRequest(validRequest()).passengers).toBe(2);
  });

  it('rejects output that is not an object', () => {
    expect(() => validateParsedRequest('a nice beach trip')).toThrow(AppError);
    expect(() => validateParsedRequest(null)).toThrow(AppError);
  });

  it('rejects an out-of-range passenger count', () => {
    expect(() => validateParsedRequest(validRequest({ passengers: 0 }))).toThrow(AppError);
    expect(() => validateParsedRequest(validRequest({ passengers: 99 }))).toThrow(AppError);
  });

  it('rejects a negative budget', () => {
    expect(() => validateParsedRequest(validRequest({ maxBudgetMajorUnits: -100 }))).toThrow(
      AppError,
    );
  });

  it('rejects an inverted night range', () => {
    expect(() => validateParsedRequest(validRequest({ minNights: 9, maxNights: 3 }))).toThrow(
      AppError,
    );
  });

  it('rejects a target budget above the maximum', () => {
    expect(() =>
      validateParsedRequest(
        validRequest({ targetBudgetMajorUnits: 900, maxBudgetMajorUnits: 850 }),
      ),
    ).toThrow(AppError);
  });

  it('raises a guardrail violation, not a generic error', () => {
    try {
      validateParsedRequest({ nonsense: true });
      expect.unreachable('should have thrown');
    } catch (error) {
      expect((error as AppError).code).toBe('AI_GUARDRAIL_VIOLATION');
    }
  });
});

describe('toSearchProfile', () => {
  const defaults = {
    earliestDeparture: '2026-06-01',
    latestReturn: '2026-06-30',
    fallbackTargetBudget: money(60000, 'EUR'),
    fallbackMaxBudget: money(80000, 'EUR'),
  };

  it('converts budgets to exact minor units deterministically', () => {
    // The model said "650"; this layer, not the model, decides that means
    // 65000 cents.
    const profile = toSearchProfile(validateParsedRequest(validRequest()), ['VIE'], defaults);

    expect(profile.targetBudget).toEqual(money(65000, 'EUR'));
    expect(profile.maxBudget).toEqual(money(85000, 'EUR'));
  });

  it('falls back to defaults when the model found no budget', () => {
    const parsed = validateParsedRequest(
      validRequest({ targetBudgetMajorUnits: null, maxBudgetMajorUnits: null }),
    );
    const profile = toSearchProfile(parsed, ['VIE'], defaults);

    expect(profile.targetBudget).toEqual(defaults.fallbackTargetBudget);
    expect(profile.maxBudget).toEqual(defaults.fallbackMaxBudget);
  });

  it('takes dates from defaults, never from the model', () => {
    const profile = toSearchProfile(validateParsedRequest(validRequest()), ['VIE'], defaults);

    expect(profile.earliestDeparture).toBe('2026-06-01');
    expect(profile.latestReturn).toBe('2026-06-30');
  });

  it('prefers deterministically resolved origins over the model list', () => {
    const parsed = validateParsedRequest(validRequest({ origins: ['XXX'] }));
    const profile = toSearchProfile(parsed, ['VIE', 'BTS'], defaults);

    expect(profile.origins).toEqual(['VIE', 'BTS']);
  });
});

describe('extractNumbers', () => {
  it('normalises thousands separators and trailing zeros', () => {
    expect(extractNumbers('EUR 1,234.00 total')).toContain('1234');
  });

  it('finds every figure in a sentence', () => {
    expect(extractNumbers('5 nights for 2 people at 742')).toEqual(['5', '2', '742']);
  });
});

describe('assertNoInventedFigures', () => {
  const facts = ['EUR 742.00', '5 nights', 'score 84'];

  it('accepts prose that only repeats supplied figures', () => {
    expect(() =>
      assertNoInventedFigures('5 nights at EUR 742.00, scoring 84.', facts, { field: 'body' }),
    ).not.toThrow();
  });

  it('rejects a hallucinated price', () => {
    // The failure this whole layer exists to prevent.
    expect(() =>
      assertNoInventedFigures('A bargain at only EUR 612.00.', facts, { field: 'body' }),
    ).toThrow(AppError);
  });

  it('reports the offending figure', () => {
    try {
      assertNoInventedFigures('Now just 612.', facts, { field: 'body' });
      expect.unreachable('should have thrown');
    } catch (error) {
      expect((error as AppError).code).toBe('AI_GUARDRAIL_VIOLATION');
      expect((error as AppError).context.invented).toContain('612');
    }
  });

  it('tolerates small counting numbers', () => {
    // "3 restaurants" must not trip the guard on every sentence.
    expect(() =>
      assertNoInventedFigures('Try 3 restaurants nearby.', facts, { field: 'body' }),
    ).not.toThrow();
  });
});

describe('withFigureGuard', () => {
  it('returns the generated text when it is clean', () => {
    const result = withFigureGuard(
      '5 nights at EUR 742.00',
      ['EUR 742.00', '5 nights'],
      { field: 'body' },
      'fallback',
    );
    expect(result).toBe('5 nights at EUR 742.00');
  });

  it('degrades to the fallback rather than failing the page', () => {
    // A trip card must still render when the explanation cannot be trusted.
    const result = withFigureGuard(
      'Only EUR 99.00!',
      ['EUR 742.00'],
      { field: 'body' },
      'fallback',
    );
    expect(result).toBe('fallback');
  });
});
