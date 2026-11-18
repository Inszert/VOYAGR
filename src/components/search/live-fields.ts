/**
 * The fields that apply themselves in the explorer. Kept in a plain module so
 * server components can read the list: a 'use client' module hands a server
 * component a client reference, not the array, so `.includes` would fail there.
 */
export const LIVE_FIELDS = [
  'origins',
  'destinations',
  'departureDate',
  'returnDate',
  'passengers',
] as const;

export type LiveField = (typeof LIVE_FIELDS)[number];

/**
 * The other fields of the shared search form: how flexible the dates are, the
 * month and trip length of a month search, and the trip-length limit. They do
 * not search on their own as they change, but a search with one of them
 * changed is a different search, so the button and Enter send it.
 */
export const FORM_FIELDS = [
  'flexibility',
  'monthStart',
  'tripNights',
  'tripLength',
  'tripDays',
] as const;

export type FormField = (typeof FORM_FIELDS)[number];

/** Every name the explorer's form owns: none of these is carried as a hidden field. */
export const OWNED_FIELDS: readonly string[] = [...LIVE_FIELDS, ...FORM_FIELDS];
