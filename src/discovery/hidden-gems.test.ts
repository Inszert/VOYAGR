import { describe, expect, it } from 'vitest';
import type { Place } from '@/providers/types';
import { hiddenGems } from './destination-detail';

/**
 * Hidden gems.
 *
 * Defended: the rule is the stated one - rated 4.5 or more, reviewed by
 * fewer people than the median for its own kind of place - and nothing else.
 */

const place = (
  name: string,
  category: Place['category'],
  rating: number | null,
  ratingCount: number,
): Place => ({
  id: name,
  providerId: 'mock-places',
  name,
  category,
  priceLevel: null,
  rating,
  ratingCount,
  distanceFromCentreMetres: 400,
});

const places = [
  place('Famous Café', 'cafe', 4.7, 2_000),
  place('Quiet Café', 'cafe', 4.8, 120),
  place('Average Café', 'cafe', 4.1, 600),
  place('Busy Beach', 'beach', 4.6, 5_000),
  place('Small Cove', 'beach', 4.5, 300),
  place('Big Beach', 'beach', 4.2, 3_000),
  place('Unrated Nook', 'cafe', null, 10),
];

describe('hiddenGems', () => {
  it('finds well-rated places with fewer reviews than their own kind', () => {
    expect(hiddenGems(places).map((gem) => gem.name)).toEqual(['Quiet Café', 'Small Cove']);
  });

  it('never counts an unrated place, however few reviews it has', () => {
    expect(hiddenGems(places).map((gem) => gem.name)).not.toContain('Unrated Nook');
  });
});
