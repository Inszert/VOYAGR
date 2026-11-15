import { addDays, isIsoDate } from '@/core/dates';
import { searchFormDefaults } from '@/search/form-defaults';
import type { DiscoveryCategory } from './categories';

/**
 * Turning a category into a search.
 *
 * A category link is an ordinary query string, so picking one is a navigation
 * rather than an interaction: it works without JavaScript, it can be shared,
 * and the back button undoes it. Section 6 asks that choosing a category
 * "immediately affect the discovery/search experience" — the most direct way
 * to do that is for it to *be* the search.
 *
 * Pure. The clock is passed in, so the same category on the same day always
 * produces the same link and a test never has to mock time.
 */

/** Values the preset will not override, because they are the user's. */
const USER_OWNED = ['origins', 'passengers', 'currency', 'targetBudget', 'maxBudget'] as const;

export interface PresetInput {
  readonly category: DiscoveryCategory;
  /** Today, as an ISO date. Decides which occurrence of a season is next. */
  readonly today: string;
  /**
   * The user's own defaults: their saved preferences, or the system ones.
   *
   * A category changes what kind of trip is being looked for. It must not
   * quietly change who is travelling, from where, or on what budget.
   */
  readonly defaults?: Readonly<Record<string, string>>;
}

/**
 * The next occurrence of a season.
 *
 * Returns the first day of the earliest listed month that has not already
 * passed, rolling into next year when it has. Picking a month that is already
 * over would produce a search with no valid dates at all.
 */
export function nextSeasonStart(months: readonly number[], today: string): string | null {
  if (months.length === 0) return null;
  if (!isIsoDate(today)) return null;

  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7));

  // Sorted by how soon each month comes round again, not by number: a window
  // spanning the new year (November to March) must not start in January.
  const soonest = [...months].sort((a, b) => ((a - month + 12) % 12) - ((b - month + 12) % 12))[0]!;

  const startsNextYear = soonest < month;
  return `${startsNextYear ? year + 1 : year}-${String(soonest).padStart(2, '0')}-01`;
}

/**
 * The query string for a category.
 *
 * Built from the user's defaults with the category's opinions layered on top,
 * so a signed-in traveller keeps their home airports and their budget.
 */
export function categoryQuery(input: PresetInput): string {
  const { category } = input;
  const defaults = { ...searchFormDefaults(input.today), ...input.defaults };

  const values: Record<string, string> = { ...defaults };

  values.travelStyle = category.travelStyle;
  values.optimisationMode = category.optimisationMode;

  if (category.minNights !== undefined) values.minNights = String(category.minNights);
  if (category.maxNights !== undefined) values.maxNights = String(category.maxNights);

  // Keep the window wide enough for the longest trip the category allows,
  // or the search planner rejects it outright.
  const nights = Number(values.maxNights);
  const seasonStart = nextSeasonStart(category.months, input.today);

  if (seasonStart) {
    values.earliestDeparture = seasonStart;
    values.latestReturn = addDays(seasonStart, Math.max(nights + 14, 30));
  }

  // The category may not touch these, whatever it wanted.
  for (const key of USER_OWNED) {
    const own = input.defaults?.[key] ?? searchFormDefaults(input.today)[key];
    if (own !== undefined) values[key] = own;
  }

  return new URLSearchParams(values).toString();
}
