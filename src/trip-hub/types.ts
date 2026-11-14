/**
 * The vocabulary of the trip hub, shared by the repositories, the service and
 * the pages.
 */

export const PLAN_ITEM_KINDS = [
  'flight',
  'stay',
  'transfer',
  'activity',
  'esim',
  'insurance',
  'other',
] as const;
export type PlanItemKind = (typeof PLAN_ITEM_KINDS)[number];

/**
 * Where an item is in the traveller's own mind.
 *
 * `booked` is only ever set by the user saying so. We cannot see a booking on
 * a partner's site, and a click is not one, so nothing here infers it.
 */
export const PLAN_ITEM_STATUSES = ['idea', 'planned', 'booked'] as const;
export type PlanItemStatus = (typeof PLAN_ITEM_STATUSES)[number];

export const PLAN_KIND_LABELS: Readonly<Record<PlanItemKind, string>> = {
  flight: 'Flight',
  stay: 'Stay',
  transfer: 'Transfer',
  activity: 'Activity',
  esim: 'eSIM',
  insurance: 'Insurance',
  other: 'Other',
};

export const PLAN_STATUS_LABELS: Readonly<Record<PlanItemStatus, string>> = {
  idea: 'Idea',
  planned: 'Planned',
  booked: 'Booked',
};
