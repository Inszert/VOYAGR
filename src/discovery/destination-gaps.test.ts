import { describe, expect, it } from 'vitest';
import type { ThingToDo } from '@/providers/types';
import { destinationGaps } from './destination-gaps';
import type { ThingsToDoOutcome } from './things-to-do';

const PLACES = 'Places to eat, see and do';
const PHOTOS = 'Photographs of the places listed';

function thing(imageFile: string | null): ThingToDo {
  return {
    id: 'Q1',
    providerId: 'wikidata',
    name: 'Place',
    kind: 'sights',
    description: null,
    latitude: 0,
    longitude: 0,
    distanceFromCentreMetres: 100,
    notability: 10,
    wikipediaUrl: null,
    imageFile,
  };
}

const ok = (...things: ThingToDo[]): ThingsToDoOutcome => ({
  status: 'ok',
  things,
  credits: {},
  sample: false,
  ageMs: 0,
});

describe('destinationGaps', () => {
  it('names the places and the photographs while the list is loading', () => {
    const gaps = destinationGaps(null, []);

    expect(gaps).toContain(PLACES);
    expect(gaps).toContain(PHOTOS);
  });

  it('drops both once places are listed and one of them has a photograph', () => {
    const gaps = destinationGaps(ok(thing(null), thing('A.jpg')), []);

    expect(gaps).not.toContain(PLACES);
    expect(gaps).not.toContain(PHOTOS);
  });

  it('keeps the photographs line when places are listed and none has a picture', () => {
    const gaps = destinationGaps(ok(thing(null)), []);

    expect(gaps).not.toContain(PLACES);
    expect(gaps).toContain(PHOTOS);
  });

  it('keeps both when the list is empty, absent or unavailable', () => {
    for (const outcome of [ok(), { status: 'absent' }, { status: 'unavailable' }] as const) {
      const gaps = destinationGaps(outcome, []);

      expect(gaps).toContain(PLACES);
      expect(gaps).toContain(PHOTOS);
    }
  });

  it('always keeps what no source carries, and names transfers only when they are missing', () => {
    const gaps = destinationGaps(ok(thing('A.jpg')), ['transfers']);

    expect(gaps).toEqual([
      'Airport transfer prices',
      'Events',
      'National holidays',
      'Travel warnings',
      'Hidden places',
      'Recommended trip lengths',
    ]);
    expect(destinationGaps(null, [])).not.toContain('Airport transfer prices');
  });
});
