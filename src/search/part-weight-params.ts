import type { PartWeights } from '@/core/trip/scoring';

/** The URL parameter for each part's weight. Plain, so a client component can import it. */
export const PART_WEIGHT_PARAMS = {
  stay: 'wStay',
  transfers: 'wTransfers',
  cost: 'wCost',
  nature: 'wNature',
  weather: 'wWeather',
  food: 'wFood',
} as const satisfies Record<keyof PartWeights, string>;
