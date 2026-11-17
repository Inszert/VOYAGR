import { describe, expect, it } from 'vitest';
import {
  STORED_SCHEMA_VERSION,
  readStoredProperty,
  readStoredRates,
  toStoredRates,
} from './stored-schema';
import { aProperty, aRate } from './test-support';

describe('stored rates', () => {
  it('round-trips offers through JSON, with Money rebuilt as integer minor units', () => {
    const stored = JSON.parse(
      JSON.stringify(toStoredRates([{ property: aProperty, rates: [aRate] }])),
    );

    const read = readStoredRates(STORED_SCHEMA_VERSION, stored);

    if (!read.ok) throw new Error(read.reason);
    expect(read.offers).toEqual([{ property: aProperty, rates: [aRate] }]);
    expect(read.offers[0]!.rates[0]!.payableAtProperty).toEqual({ amount: 400, currency: 'EUR' });
  });

  it('keeps an unpriced hotel (no rates) as an offer with an empty list, never a zero price', () => {
    const read = readStoredRates(STORED_SCHEMA_VERSION, [{ property: aProperty, rates: [] }]);

    if (!read.ok) throw new Error(read.reason);
    expect(read.offers[0]!.rates).toEqual([]);
  });

  it('rejects a row written under another schema version', () => {
    const stored = toStoredRates([{ property: aProperty, rates: [aRate] }]);

    expect(readStoredRates(STORED_SCHEMA_VERSION - 1, stored)).toEqual({
      ok: false,
      reason: 'schema_version',
    });
    expect(readStoredRates(STORED_SCHEMA_VERSION + 1, stored)).toEqual({
      ok: false,
      reason: 'schema_version',
    });
  });

  it('rejects a price that is not integer minor units, and a zero or missing total', () => {
    const bad = (patch: Record<string, unknown>) =>
      readStoredRates(STORED_SCHEMA_VERSION, [
        { property: aProperty, rates: [{ ...aRate, ...patch }] },
      ]);

    expect(bad({ total: { amount: 333.33, currency: 'EUR' } })).toEqual({
      ok: false,
      reason: 'invalid',
    });
    expect(bad({ total: { amount: 0, currency: 'EUR' } }).ok).toBe(false);
    expect(bad({ total: undefined }).ok).toBe(false);
    expect(bad({ total: { amount: '33333', currency: 'EUR' } }).ok).toBe(false);
  });

  it('requires unknown to be an explicit null, not a missing field', () => {
    const { payableAtProperty: _omitted, ...withoutField } = aRate;

    expect(
      readStoredRates(STORED_SCHEMA_VERSION, [{ property: aProperty, rates: [withoutField] }]).ok,
    ).toBe(false);
  });

  it('rejects something that is not a list of offers', () => {
    expect(readStoredRates(STORED_SCHEMA_VERSION, { not: 'a list' }).ok).toBe(false);
    expect(readStoredRates(STORED_SCHEMA_VERSION, null).ok).toBe(false);
  });
});

describe('stored property', () => {
  it('reads a valid property and returns null for a damaged one', () => {
    expect(readStoredProperty(JSON.parse(JSON.stringify(aProperty)))).toEqual(aProperty);
    expect(readStoredProperty({ ...aProperty, name: '' })).toBeNull();
    expect(readStoredProperty('nope')).toBeNull();
  });
});
