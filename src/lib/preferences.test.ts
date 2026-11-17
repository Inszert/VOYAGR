import { describe, expect, it } from 'vitest';
import {
  PREFERENCES_KEY,
  clearPreferences,
  paramsFromPreferences,
  preferencesFromParams,
  readPreferences,
  writePreferences,
  type ExplorePreferences,
  type PreferenceStorage,
} from './preferences';

function fakeStorage(): PreferenceStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
    removeItem: (key) => void data.delete(key),
  };
}

const throwing: PreferenceStorage = {
  getItem: () => {
    throw new Error('blocked');
  },
  setItem: () => {
    throw new Error('full');
  },
  removeItem: () => {
    throw new Error('blocked');
  },
};

const prefs: ExplorePreferences = {
  origins: ['AMS', 'BRU'],
  destinations: 'anywhere',
  passengers: 2,
  flexibility: 'month',
  weights: { wStay: '3' },
  filters: { fDirect: '1', fMaxTotal: '900' },
};

describe('preferences storage', () => {
  it('round-trips valid choices', () => {
    const storage = fakeStorage();
    writePreferences(storage, prefs);
    expect(readPreferences(storage)).toEqual(prefs);
  });

  it('ignores corrupt JSON', () => {
    const storage = fakeStorage();
    storage.data.set(PREFERENCES_KEY, '{not json');
    expect(readPreferences(storage)).toBeNull();
  });

  it('ignores a wrong shape', () => {
    const storage = fakeStorage();
    storage.data.set(PREFERENCES_KEY, JSON.stringify({ origins: 'AMS', weights: {}, filters: {} }));
    expect(readPreferences(storage)).toBeNull();
    storage.data.set(
      PREFERENCES_KEY,
      JSON.stringify({ ...prefs, filters: { somethingElse: '1' } }),
    );
    expect(readPreferences(storage)).toBeNull();
  });

  it('never throws when storage throws or is missing', () => {
    expect(readPreferences(throwing)).toBeNull();
    expect(() => writePreferences(throwing, prefs)).not.toThrow();
    expect(() => clearPreferences(throwing)).not.toThrow();
    expect(readPreferences(null)).toBeNull();
    expect(() => writePreferences(undefined, prefs)).not.toThrow();
  });

  it('clear removes the key', () => {
    const storage = fakeStorage();
    writePreferences(storage, prefs);
    clearPreferences(storage);
    expect(storage.data.has(PREFERENCES_KEY)).toBe(false);
    expect(readPreferences(storage)).toBeNull();
  });
});

describe('preferences and URL parameters', () => {
  it('keeps the remembered subset and drops the dates', () => {
    const params = new URLSearchParams(
      'origins=ams, bru&destinations=anywhere&passengers=2&flexibility=month&departureDate=2027-01-01&returnDate=2027-01-08&wStay=3&fDirect=1&fDates=a..b',
    );
    const result = preferencesFromParams(params);
    expect(result).toEqual({
      origins: ['AMS', 'BRU'],
      destinations: 'anywhere',
      passengers: 2,
      flexibility: 'month',
      weights: { wStay: '3' },
      filters: { fDirect: '1' },
    });
    const back = paramsFromPreferences(result!);
    expect(back.has('departureDate')).toBe(false);
    expect(back.get('origins')).toBe('AMS, BRU');
    expect(back.get('wStay')).toBe('3');
  });

  it('remembers nothing without origins', () => {
    expect(preferencesFromParams(new URLSearchParams('passengers=2'))).toBeNull();
  });

  it('caps origins at five', () => {
    const result = preferencesFromParams(new URLSearchParams('origins=AAA,BBB,CCC,DDD,EEE,FFF'));
    expect(result?.origins).toHaveLength(5);
  });
});
