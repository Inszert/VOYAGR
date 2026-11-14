import { describe, expect, it } from 'vitest';
import { emergencyInfoFor, parseEmergencyDataset } from './emergency';

const valid = {
  source: {
    name: 'Wikidata',
    url: 'https://www.wikidata.org/wiki/Property:P2852',
    property: 'P2852',
    license: 'CC0 1.0',
    retrievedOn: '2026-11-14',
  },
  countries: { DE: { numbers: ['110', '112'] } },
};

describe('emergencyInfoFor', () => {
  it('returns numbers with their source and date for a known country', () => {
    const info = emergencyInfoFor('de', parseEmergencyDataset(valid));
    expect(info?.numbers).toEqual(['110', '112']);
    expect(info?.source).toMatchObject({ name: 'Wikidata', retrievedOn: '2026-11-14' });
  });

  it('returns null for a country with no data, never a guessed 112 or 911', () => {
    const data = parseEmergencyDataset(valid);
    expect(emergencyInfoFor('FR', data)).toBeNull();
    expect(emergencyInfoFor('US', data)).toBeNull();
  });

  it('returns null for a missing or empty code', () => {
    const data = parseEmergencyDataset(valid);
    expect(emergencyInfoFor(null, data)).toBeNull();
    expect(emergencyInfoFor(undefined, data)).toBeNull();
    expect(emergencyInfoFor('', data)).toBeNull();
  });

  it('returns null for every country when there is no dataset', () => {
    expect(emergencyInfoFor('DE', null)).toBeNull();
  });
});

describe('parseEmergencyDataset', () => {
  it('rejects a dataset with no source or date', () => {
    expect(parseEmergencyDataset({ countries: valid.countries })).toBeNull();
    expect(
      parseEmergencyDataset({ ...valid, source: { ...valid.source, retrievedOn: 'yesterday' } }),
    ).toBeNull();
  });

  it('rejects a number that is not dialable and a country with no numbers', () => {
    expect(
      parseEmergencyDataset({ ...valid, countries: { DE: { numbers: ['call us'] } } }),
    ).toBeNull();
    expect(parseEmergencyDataset({ ...valid, countries: { DE: { numbers: [] } } })).toBeNull();
  });

  it('rejects a malformed country code', () => {
    expect(
      parseEmergencyDataset({ ...valid, countries: { deu: { numbers: ['112'] } } }),
    ).toBeNull();
  });
});

describe('the committed dataset', () => {
  it('loads, and carries a source and a retrieval date', () => {
    const info = emergencyInfoFor('DE');
    // If the file were absent or invalid this is null, and the UI would say so;
    // the committed file is expected to be valid.
    expect(info).not.toBeNull();
    expect(info?.source.retrievedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
