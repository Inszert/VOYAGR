import { findDestination } from '@/providers/fixtures/destinations';
import type { AirportCode } from '@/core/trip/types';

/**
 * Airport code to place name, for display only.
 *
 * A deliberate stand-in for the `destinations` table (specification section
 * 21), which does not exist yet. It is the one place in the application that
 * reads provider fixture data, and it is confined to this module so that
 * replacing it later is a change to one function rather than a hunt through
 * components.
 *
 * Display only. No cost, constraint or score reads anything from here, and an
 * unknown code falls back to itself rather than to an invented name.
 */
export function resolveDestinationNames(
  codes: readonly AirportCode[],
): Record<AirportCode, string> {
  const names: Record<AirportCode, string> = {};

  for (const code of codes) {
    const fixture = findDestination(code);
    if (fixture) names[code] = fixture.name;
  }

  return names;
}
