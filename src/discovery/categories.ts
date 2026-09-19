import type { OptimisationMode, TravelStyle } from '@/core/trip/types';

/**
 * Discovery categories (1.10.1 section 6).
 *
 * A category is a **preset over the search we already have**, not a new kind of
 * search and not intelligence. "Beach escapes" means a travel style, an
 * optimisation mode and — where the name implies one — a season. Nothing here
 * knows which destinations are beachy; that is a fact about places, and it
 * lives in the catalogue.
 *
 * Kept deliberately dumb for that reason. Seasonal recommendation, hidden
 * places and event awareness are sections 15 to 22 and need data the product
 * does not have. A category that guessed at them would be inventing the
 * intelligence rather than waiting for it.
 *
 * Pure and deterministic: a category plus a date produces the same query every
 * time, which is what lets the homepage be a set of ordinary links.
 */

export type CategoryId =
  | 'beach'
  | 'city-break'
  | 'mountains'
  | 'food-and-wine'
  | 'nightlife'
  | 'culture'
  | 'adventure'
  | 'budget'
  | 'warm-escape'
  | 'luxury';

/** Which months a category implies, 1-12. Empty when it implies none. */
export type SeasonMonths = readonly number[];

export interface DiscoveryCategory {
  readonly id: CategoryId;
  readonly title: string;
  /** One line explaining what picking this actually changes. */
  readonly description: string;
  readonly travelStyle: TravelStyle;
  readonly optimisationMode: OptimisationMode;
  /**
   * Months this category is about.
   *
   * Only where the name genuinely implies a season. "Beach" does not: a beach
   * holiday in February is a different destination, not a different month, and
   * choosing one for the user would be a recommendation we cannot justify.
   */
  readonly months: SeasonMonths;
  /** Minimum nights the category implies, where it implies one. */
  readonly minNights?: number;
  readonly maxNights?: number;
}

/**
 * The catalogue of categories.
 *
 * Fewer than section 6 lists, on purpose. Every one here maps onto a real
 * `TravelStyle` or `OptimisationMode` that the scoring engine already
 * understands, so picking it demonstrably changes the ranking. The rest of the
 * list — northern lights, autumn colours, spring blossoms, hidden places,
 * events — needs seasonal and place data the product does not have, and a
 * button that changed nothing would be worse than an absent one.
 */
export const DISCOVERY_CATEGORIES: readonly DiscoveryCategory[] = [
  {
    id: 'beach',
    title: 'Beach escapes',
    description: 'Ranks sun, sea temperature and how close the hotel is to the water.',
    travelStyle: 'beach',
    optimisationMode: 'maximise_beach_time',
    months: [],
    minNights: 5,
  },
  {
    id: 'city-break',
    title: 'City breaks',
    description: 'Short, central, and judged on how much of the city you actually get.',
    travelStyle: 'explore',
    optimisationMode: 'maximise_exploration',
    months: [],
    minNights: 2,
    maxNights: 4,
  },
  {
    id: 'food-and-wine',
    title: 'Food and wine',
    description: 'Weights location and neighbourhood over hotel stars.',
    travelStyle: 'food',
    optimisationMode: 'maximise_food_quality',
    months: [],
  },
  {
    id: 'culture',
    title: 'Culture',
    description: 'Museums, old towns and time on your feet rather than by a pool.',
    travelStyle: 'culture',
    optimisationMode: 'maximise_exploration',
    months: [],
  },
  {
    id: 'nightlife',
    title: 'Nightlife',
    description: 'Central, late, and unbothered by an early flight home.',
    travelStyle: 'nightlife',
    optimisationMode: 'maximise_exploration',
    months: [],
    minNights: 2,
    maxNights: 4,
  },
  {
    id: 'adventure',
    title: 'Adventure',
    description: 'Maximises daylight at the destination and tolerates a rougher hotel.',
    travelStyle: 'adventure',
    optimisationMode: 'maximise_exploration',
    months: [],
  },
  {
    id: 'mountains',
    title: 'Mountains',
    description: 'Cooler air, longer days out, and a base to come back to.',
    travelStyle: 'adventure',
    optimisationMode: 'best_value',
    months: [],
    minNights: 4,
  },
  {
    id: 'warm-escape',
    title: 'Warm escape',
    description: 'Winter months only, ranked hard on the weather outlook.',
    travelStyle: 'chill',
    optimisationMode: 'maximise_beach_time',
    // The one category whose name genuinely is about a season.
    months: [11, 12, 1, 2, 3],
    minNights: 5,
  },
  {
    id: 'budget',
    title: 'Travel cheaply',
    description: 'Cheapest complete trip, with every cost counted rather than the fare alone.',
    travelStyle: 'balanced',
    optimisationMode: 'cheapest',
    months: [],
  },
  {
    id: 'luxury',
    title: 'Something special',
    description: 'Spends the budget on the hotel and the ride rather than on saving money.',
    travelStyle: 'luxury',
    optimisationMode: 'nicest_within_budget',
    months: [],
  },
];

export function findCategory(id: string): DiscoveryCategory | undefined {
  return DISCOVERY_CATEGORIES.find((category) => category.id === id);
}
