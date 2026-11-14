import { describe, expect, it } from 'vitest';
import { describeAge } from './updated-ago';

describe('describeAge', () => {
  it.each([
    [null, 'Update time unknown'],
    [-5_000, 'Updated just now'],
    [59_999, 'Updated just now'],
    [60_000, 'Updated 1 min ago'],
    [12 * 60_000 + 30_000, 'Updated 12 min ago'],
    [60 * 60_000, 'Updated 1 h ago'],
    [24 * 60 * 60_000, 'Updated 1 d ago'],
  ])('says %s as "%s"', (ageMs, expected) => {
    expect(describeAge(ageMs)).toBe(expected);
  });
});
