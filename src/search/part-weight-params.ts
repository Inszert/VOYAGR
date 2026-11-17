import type { PartWeights } from '@/core/trip/scoring';

/** The URL parameter for each part's weight. Plain, so a client component can import it. */
export const PART_WEIGHT_PARAMS = {
  flights: 'wFlights',
  stay: 'wStay',
  activities: 'wActivities',
  transfers: 'wTransfers',
} as const satisfies Record<keyof PartWeights, string>;
