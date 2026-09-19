import { describe, expect, it } from 'vitest';
import {
  combineProvenance,
  isRealOffer,
  PROVENANCE_EMPHASIS,
  PROVENANCE_EXPLANATION,
  PROVENANCE_LABEL,
  provenanceForProvider,
  type DataProvenance,
} from './provenance';

/**
 * Provenance.
 *
 * The rule the whole type exists for: a number the user cannot act on must
 * never be presentable as one they can.
 */

const ALL: DataProvenance[] = [
  'live',
  'cached',
  'estimated',
  'historical',
  'typical',
  'mock',
  'ai-generated',
  'unavailable',
];

describe('labels', () => {
  it('has a label and an explanation for every provenance', () => {
    for (const provenance of ALL) {
      expect(PROVENANCE_LABEL[provenance]).toBeTruthy();
      expect(PROVENANCE_EXPLANATION[provenance]).toBeTruthy();
    }
  });

  it('says plainly that mock data cannot be booked', () => {
    // The one label a user must not be able to misread as an offer.
    expect(PROVENANCE_LABEL.mock).toBe('Demo data');
    expect(PROVENANCE_EXPLANATION.mock).toContain('cannot be booked');
  });

  it('never calls an estimate a price', () => {
    expect(PROVENANCE_LABEL.estimated).not.toMatch(/price/i);
    expect(PROVENANCE_EXPLANATION.estimated).toContain('Nobody has quoted this');
  });
});

describe('emphasis', () => {
  it('makes mock data intrusive and a live price quiet', () => {
    // Every other provenance qualifies a real offer; this one says there is
    // no offer, and a user must not be able to miss it.
    expect(PROVENANCE_EMPHASIS.mock).toBe('intrusive');
    expect(PROVENANCE_EMPHASIS.live).toBe('quiet');
  });

  it('assigns an emphasis to every provenance', () => {
    for (const provenance of ALL) {
      expect(PROVENANCE_EMPHASIS[provenance]).toBeTruthy();
    }
  });
});

describe('isRealOffer', () => {
  it('counts only what a provider actually quoted', () => {
    expect(isRealOffer('live')).toBe(true);
    expect(isRealOffer('cached')).toBe(true);

    for (const provenance of [
      'estimated',
      'typical',
      'mock',
      'historical',
      'unavailable',
    ] as const) {
      expect(isRealOffer(provenance)).toBe(false);
    }
  });
});

describe('combineProvenance', () => {
  it('lets the weakest claim win', () => {
    // A total is only as trustworthy as its least trustworthy line.
    expect(combineProvenance(['live', 'estimated'])).toBe('estimated');
    expect(combineProvenance(['live', 'live'])).toBe('live');
    expect(combineProvenance(['cached', 'live'])).toBe('cached');
  });

  it('makes one mock component contaminate the whole total', () => {
    // A trip cannot be half-bookable.
    expect(combineProvenance(['live', 'live', 'mock'])).toBe('mock');
    expect(combineProvenance(['mock', 'estimated'])).toBe('mock');
  });

  it('reports nothing at all as unavailable rather than guessing', () => {
    expect(combineProvenance([])).toBe('unavailable');
  });
});

describe('provenanceForProvider', () => {
  it('derives provenance from the adapter rather than from a guess', () => {
    expect(provenanceForProvider(true)).toBe('mock');
    expect(provenanceForProvider(false)).toBe('live');
  });
});
