import { findDestination } from '@/providers/fixtures/destinations';
import type { AirportCode } from '@/core/trip/types';
import type { DestinationGeo } from '@/discovery/map-model';

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

/**
 * Where a destination is, for the discovery map.
 *
 * Lives here for the same reason the names do: this module is the only place
 * in the application allowed to read provider fixture data, so replacing the
 * stand-in with the real `destinations` table is a change to one file.
 *
 * Returns null for anything the catalogue does not know, and the map drops it.
 * A marker placed somewhere plausible would be an invented fact, and on a map
 * an invented fact is unusually convincing - a dot on a coastline looks like
 * knowledge.
 */
export function resolveDestinationGeo(destination: AirportCode): DestinationGeo | null {
  const fixture = findDestination(destination);
  if (!fixture) return null;

  const [longitude, latitude] = fixture.position;
  // The fallback profile sits at [0, 0], which is in the Atlantic. Treat it as
  // "unplaced" rather than drawing the Gulf of Guinea.
  if (longitude === 0 && latitude === 0) return null;

  return {
    name: fixture.name,
    country: fixture.country,
    position: fixture.position,
    // Everything the product can currently reach is an airport a scheduled
    // airline flies to. Smaller tiers arrive with the places they describe.
    tier: 'major',
  };
}
