import { createHash } from 'node:crypto';
import type { SearchProfile } from '@/core/trip/types';
import type { TripSearchRepository } from '@/db/repository';
import { getLogger } from '@/lib/logger';

const log = getLogger('discovery.record-search');

/** A signed-in user's identical search is written at most this often. */
export const RECORD_SEARCH_INTERVAL_MS = 60_000;

/**
 * A stable id for one user's one search.
 *
 * sha256 of the user and the search's own content (profile and destinations),
 * laid out as a UUID so it fits `trip_searches.id`. The same search by the same
 * user is the same row, which is what makes the write an upsert without a
 * migration. Another user's identical search hashes to a different id.
 */
export function searchRecordId(
  userId: string,
  profile: SearchProfile,
  destinations: readonly string[],
): string {
  const hex = createHash('sha256')
    .update(JSON.stringify([userId, profile, [...destinations]]))
    .digest('hex');
  // Version nibble 5 and variant 8..b, so it is a well-formed UUID.
  const variant = ((parseInt(hex[16]!, 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

/**
 * Record the search a signed-in user just ran.
 *
 * Best effort by design: it never throws, and never delays the page beyond one
 * read and one write. Skipped when the same search was recorded within
 * `RECORD_SEARCH_INTERVAL_MS`.
 */
export async function recordSearch(
  repository: TripSearchRepository,
  input: {
    readonly userId: string;
    readonly profile: SearchProfile;
    readonly destinations: readonly string[];
    readonly now?: number;
  },
): Promise<void> {
  try {
    // The table requires at least one destination.
    if (input.destinations.length === 0) return;

    const id = searchRecordId(input.userId, input.profile, input.destinations);
    const existing = await repository.findById(id);
    const clock = input.now ?? Date.now();

    if (existing && clock - Date.parse(existing.updatedAt) < RECORD_SEARCH_INTERVAL_MS) return;

    const shown = input.destinations.slice(0, 3).join(', ');
    const more = input.destinations.length > 3 ? ` +${input.destinations.length - 3}` : '';

    await repository.upsert({
      id,
      userId: input.userId,
      name: `${shown}${more}`,
      profile: input.profile,
      destinations: input.destinations,
    });
  } catch (error) {
    log.warn({ err: error }, 'search could not be recorded');
  }
}
