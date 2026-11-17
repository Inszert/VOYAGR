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
