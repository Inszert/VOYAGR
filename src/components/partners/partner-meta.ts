import type { IconName } from '@/components/ui';
import type { PartnerCategory } from '@/booking/partners';

/**
 * How each partner category is drawn and named.
 *
 * Exhaustive over `PartnerCategory` on purpose: a category added to the
 * registry without a heading here fails the typecheck, rather than rendering
 * as a group nobody can name or not rendering at all.
 */

export const CATEGORY_ICON: Record<PartnerCategory, IconName> = {
  transfer: 'car',
  esim: 'wifi',
  compensation: 'clock',
  car_rental: 'car',
  activities: 'sparkle',
  insurance: 'shield',
  rail_bus: 'train',
  luggage: 'tag',
  stay: 'bed',
};

/** What the offer is, as a caption on its card. */
export const CATEGORY_LABEL: Record<PartnerCategory, string> = {
  transfer: 'Airport transfer',
  esim: 'Travel eSIM',
  compensation: 'Flight compensation',
  car_rental: 'Car hire',
  activities: 'Things to do',
  insurance: 'Travel insurance',
  rail_bus: 'Trains and buses',
  luggage: 'Luggage storage',
  stay: 'Stays',
};

/** The heading over a group of offers. */
export const CATEGORY_HEADING: Record<PartnerCategory, string> = {
  transfer: 'Getting from the airport',
  esim: 'Stay connected',
  compensation: 'If your flight is delayed',
  car_rental: 'Getting around',
  activities: 'Things to do',
  insurance: 'Travel cover',
  rail_bus: 'Trains and buses',
  luggage: 'Somewhere to leave your bags',
  stay: 'Where to stay',
};

/** The order the groups appear in. */
export const CATEGORY_ORDER: readonly PartnerCategory[] = [
  'transfer',
  'esim',
  'compensation',
  'car_rental',
  'activities',
  'insurance',
  'rail_bus',
  'luggage',
  'stay',
];
