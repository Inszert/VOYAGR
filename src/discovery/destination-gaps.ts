import type { ThingsToDoOutcome } from './things-to-do';

/**
 * What a destination page says it cannot tell you yet.
 *
 * Each line is dropped only once the page above it actually carries the thing:
 * a list of places once a real list is shown, photographs once at least one of
 * those places has one. `things` is null while it is still loading, which is the
 * pessimistic reading - the note names everything until the data has arrived.
 */
export function destinationGaps(
  things: ThingsToDoOutcome | null,
  notAvailable: readonly string[],
): string[] {
  const placesListed = things?.status === 'ok' && things.things.length > 0;
  const photosListed =
    things?.status === 'ok' && things.things.some((thing) => thing.imageFile !== null);

  return [
    // A slot with no data source says so here, instead of an empty
    // section that reads as "nothing to report".
    ...(notAvailable.includes('transfers') ? ['Airport transfer prices'] : []),
    ...(placesListed ? [] : ['Places to eat, see and do']),
    ...(photosListed ? [] : ['Photographs of the places listed']),
    'Events',
    'National holidays',
    'Travel warnings',
    'Hidden places',
    'Recommended trip lengths',
  ];
}
