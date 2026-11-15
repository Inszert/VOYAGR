/**
 * The three parts of a trip, and how to read one out of an address.
 *
 * Its own module, with no `'use client'`, because the trip page is a server
 * component and has to call `isTripTab` itself: a function exported from a
 * client module cannot be called on the server, and the page crashed on every
 * trip with "Attempted to call isTripTab() from the server".
 */

export type TripTab = 'plan' | 'money' | 'emergency';

export const TRIP_TABS: readonly TripTab[] = ['plan', 'money', 'emergency'];

export function isTripTab(value: unknown): value is TripTab {
  return typeof value === 'string' && (TRIP_TABS as readonly string[]).includes(value);
}
