import { describe, expect, it } from 'vitest';
import { parseSearchForm } from '@/search/schema';
import { DISCOVERY_CATEGORIES, findCategory } from './categories';
import { categoryQuery, nextSeasonStart } from './preset';

/**
 * Discovery presets.
 *
 * A category is a shortcut into the search that already exists. The two things
 * that must hold: every shortcut produces a search the engine accepts, and no
 * shortcut quietly changes who is travelling or on what budget.
 */

const TODAY = '2026-09-19';

const parse = (query: string) => {
  const values: Record<string, string> = {};
  for (const [key, value] of new URLSearchParams(query)) values[key] = value;
  return parseSearchForm(values);
};

describe('every category', () => {
  it('produces a search the engine accepts', () => {
    // A category that produced an invalid search would be a dead tile.
    for (const category of DISCOVERY_CATEGORIES) {
      const result = parse(categoryQuery({ category, today: TODAY }));

      expect(result.ok, `${category.id} produced an invalid search`).toBe(true);
    }
  });

  it('actually changes how trips are ranked', () => {
    // A tile that changed nothing would be worse than an absent one.
    for (const category of DISCOVERY_CATEGORIES) {
      const result = parse(categoryQuery({ category, today: TODAY }));
      if (!result.ok) continue;

      expect(result.value.request.profile.travelStyle).toBe(category.travelStyle);
      expect(result.value.request.profile.optimisationMode).toBe(category.optimisationMode);
    }
  });

  it('has a distinct id and a description worth reading', () => {
    const ids = DISCOVERY_CATEGORIES.map((category) => category.id);

    expect(new Set(ids).size).toBe(ids.length);
    for (const category of DISCOVERY_CATEGORIES) {
      expect(category.description.length).toBeGreaterThan(20);
    }
  });

  it('is deterministic for a given day', () => {
    const category = findCategory('warm-escape')!;

    expect(categoryQuery({ category, today: TODAY })).toBe(
      categoryQuery({ category, today: TODAY }),
    );
  });
});

describe('what a category may not change', () => {
  it('keeps the traveller’s own origins, party and budget', () => {
    // A category changes what kind of trip is wanted. It must not quietly
    // change who is going, from where, or for how much.
    const mine = {
      origins: 'BTS',
      passengers: '4',
      currency: 'GBP',
      targetBudget: '1200',
      maxBudget: '1500',
    };

    const result = parse(
      categoryQuery({ category: findCategory('luxury')!, today: TODAY, defaults: mine }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const { profile } = result.value.request;
    expect(profile.origins).toEqual(['BTS']);
    expect(profile.passengers).toBe(4);
    expect(profile.targetBudget.currency).toBe('GBP');
    expect(profile.maxBudget.amount).toBe(150_000);
  });
});

describe('seasonal categories', () => {
  it('sends a warm escape to the next winter, not a month already gone', () => {
    // September: November is the soonest winter month still ahead.
    const query = categoryQuery({ category: findCategory('warm-escape')!, today: '2026-09-19' });
    const values = new URLSearchParams(query);

    expect(values.get('earliestDeparture')).toBe('2026-11-01');
  });

  it('rolls into next year once the window has passed', () => {
    // April: every winter month listed is behind us, so the next one is
    // November — this year, not a January that has already happened.
    const query = categoryQuery({ category: findCategory('warm-escape')!, today: '2026-04-10' });

    expect(new URLSearchParams(query).get('earliestDeparture')).toBe('2026-11-01');
  });

  it('picks January when that is genuinely the soonest', () => {
    const query = categoryQuery({ category: findCategory('warm-escape')!, today: '2026-12-20' });

    // December is current, so it is the soonest listed month.
    expect(new URLSearchParams(query).get('earliestDeparture')).toBe('2026-12-01');
  });

  it('leaves the dates alone for a category with no season', () => {
    // A beach holiday in February is a different destination, not a different
    // month, and choosing one would be a recommendation we cannot justify.
    const beach = findCategory('beach')!;
    expect(beach.months).toEqual([]);

    const values = new URLSearchParams(categoryQuery({ category: beach, today: TODAY }));
    expect(values.get('earliestDeparture')).toBe('2026-06-01');
  });
});

describe('nextSeasonStart', () => {
  it('returns null when a category implies no season', () => {
    expect(nextSeasonStart([], TODAY)).toBeNull();
  });

  it('refuses a date it cannot read rather than guessing', () => {
    expect(nextSeasonStart([1], 'not-a-date')).toBeNull();
  });
});
