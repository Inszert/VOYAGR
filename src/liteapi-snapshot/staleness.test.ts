import { describe, expect, it } from 'vitest';
import {
  MISSING_LINE,
  classifySnapshot,
  freshLimitMs,
  intervalHours,
  snapshotTtlMs,
  stalenessLine,
} from './staleness';

const HOUR = 3_600_000;
const NOW = Date.parse('2027-01-10T20:00:00.000Z');
const at = (hoursAgo: number) => new Date(NOW - hoursAgo * HOUR).toISOString();
const row = (hoursAgo: number, ttlHours = 24) => ({
  observedAt: at(hoursAgo),
  expiresAt: new Date(NOW - hoursAgo * HOUR + ttlHours * HOUR).toISOString(),
});

describe('snapshot timing', () => {
  it('derives everything from refreshes a day', () => {
    expect(intervalHours(3)).toBe(8);
    expect(freshLimitMs(3)).toBe(16 * HOUR);
    expect(snapshotTtlMs(3)).toBe(24 * HOUR);
    expect(freshLimitMs(24)).toBe(2 * HOUR);
    expect(snapshotTtlMs(1)).toBe(72 * HOUR);
  });
});

describe('classifySnapshot', () => {
  it('is fresh up to and including 16 hours old', () => {
    expect(classifySnapshot(row(5), NOW, 3)).toMatchObject({ state: 'fresh', ageHours: 5 });
    expect(classifySnapshot(row(16), NOW, 3)).toMatchObject({ state: 'fresh', ageHours: 16 });
  });

  it('is aging past 16 hours', () => {
    expect(classifySnapshot(row(17), NOW, 3)).toMatchObject({ state: 'aging', ageHours: 17 });
    expect(classifySnapshot(row(23), NOW, 3)).toMatchObject({ state: 'aging', ageHours: 23 });
  });

  it('is missing with no row, and once the row has expired', () => {
    expect(classifySnapshot(null, NOW, 3).state).toBe('missing');
    expect(classifySnapshot(row(24), NOW, 3).state).toBe('missing');
    expect(classifySnapshot(row(30), NOW, 3).state).toBe('missing');
  });

  it('is unknown, with no age, when it was observed in the future', () => {
    const future = {
      observedAt: new Date(NOW + 3 * HOUR).toISOString(),
      expiresAt: new Date(NOW + 27 * HOUR).toISOString(),
    };
    expect(classifySnapshot(future, NOW, 3)).toMatchObject({ state: 'unknown', ageHours: null });
  });

  it('follows the interval: at 24 refreshes a day, 2.5 hours is already aging', () => {
    expect(classifySnapshot(row(2.5, 3), NOW, 24).state).toBe('aging');
    expect(classifySnapshot(row(1, 3), NOW, 24).state).toBe('fresh');
  });
});

describe('stalenessLine, the exact words', () => {
  it('says "Updated N hours ago" when fresh', () => {
    expect(stalenessLine(classifySnapshot(row(5), NOW, 3))).toBe('Updated 5 hours ago');
    expect(stalenessLine(classifySnapshot(row(1), NOW, 3))).toBe('Updated 1 hour ago');
    expect(stalenessLine(classifySnapshot(row(0), NOW, 3))).toBe('Updated less than an hour ago');
  });

  it('says "Prices last checked N hours ago" when aging', () => {
    expect(stalenessLine(classifySnapshot(row(20), NOW, 3))).toBe(
      'Prices last checked 20 hours ago',
    );
  });

  it('says the missing line, and nothing at all about age when unknown', () => {
    expect(stalenessLine(classifySnapshot(null, NOW, 3))).toBe(
      'Hotel prices are not loaded for these dates yet.',
    );
    expect(MISSING_LINE).toBe('Hotel prices are not loaded for these dates yet.');
    expect(stalenessLine({ state: 'unknown', observedAt: at(-2), ageHours: null })).toBeNull();
  });
});
