import { describe, expect, it } from 'vitest';
import type { ThingToDo } from '@/providers/types';
import { slideshowFrames } from './slideshow-frames';

function thing(id: string, imageFile: string | null): ThingToDo {
  return {
    id,
    providerId: 'wikidata',
    name: `Place ${id}`,
    kind: 'sights',
    description: null,
    latitude: 41.9,
    longitude: 12.5,
    distanceFromCentreMetres: 1000,
    notability: 10,
    wikipediaUrl: null,
    imageFile,
  };
}

const ok = (things: ThingToDo[], credits = {}) => ({ status: 'ok', things, credits });

describe('slideshowFrames', () => {
  it('is nothing when the places are absent or unavailable', () => {
    expect(
      slideshowFrames({ code: 'FCO', name: 'Rome', outcome: { status: 'absent' } }),
    ).toBeNull();
    expect(
      slideshowFrames({ code: 'FCO', name: 'Rome', outcome: { status: 'unavailable' } }),
    ).toBeNull();
  });

  it('is nothing with fewer than three real photographs', () => {
    const things = [thing('Q1', 'A.jpg'), thing('Q2', 'B.jpg'), thing('Q3', null)];

    expect(slideshowFrames({ code: 'FCO', name: 'Rome', outcome: ok(things) })).toBeNull();
  });

  it('opens on the illustration, then real photographs, six frames at most', () => {
    const things = Array.from({ length: 12 }, (_, i) => thing(`Q${i}`, `File ${i}.jpg`));
    const frames = slideshowFrames({ code: 'AYT', name: 'Antalya', outcome: ok(things) })!;

    expect(frames).toHaveLength(6);
    expect(frames[0]!.kind).toBe('illustration');
    expect(frames[0]!.credit.text).toBe('AI-generated illustration');
    expect(frames.slice(1).every((frame) => frame.kind === 'photo')).toBe(true);
  });

  it('uses six photographs when no illustration ships for the place', () => {
    const things = Array.from({ length: 12 }, (_, i) => thing(`Q${i}`, `File ${i}.jpg`));
    const frames = slideshowFrames({ code: 'ZZZ', name: 'Nowhere', outcome: ok(things) })!;

    expect(frames).toHaveLength(6);
    expect(frames.every((frame) => frame.kind === 'photo')).toBe(true);
  });

  it('serves photographs from our own route and skips places without one or a repeated file', () => {
    const things = [
      thing('Q1', 'A b.jpg'),
      thing('Q2', null),
      thing('Q3', 'A b.jpg'),
      thing('Q4', 'C.jpg'),
      thing('Q5', 'D.jpg'),
    ];
    const frames = slideshowFrames({ code: 'ZZZ', name: 'Nowhere', outcome: ok(things) })!;

    expect(frames.map((frame) => frame.caption)).toEqual(['Place Q1', 'Place Q4', 'Place Q5']);
    for (const frame of frames) {
      expect(frame.kind === 'photo' && frame.src).toMatch(/^\/api\/places\/image\?/);
      expect(frame.kind === 'photo' && frame.srcSet).not.toMatch(/https?:/);
    }
  });

  it('asks for the widest offered width for each photograph, with the smaller ones in its srcset', () => {
    const things = [thing('Q1', 'A.jpg'), thing('Q2', 'B.jpg'), thing('Q3', 'C.jpg')];
    const frames = slideshowFrames({ code: 'ZZZ', name: 'Nowhere', outcome: ok(things) })!;

    for (const frame of frames) {
      expect(frame.kind === 'photo' && frame.src).toMatch(/w=1600$/);
      expect(frame.kind === 'photo' && frame.srcSet).toMatch(
        /w=640 640w, \/api\/places\/image\?.*w=1280 1280w, \/api\/places\/image\?.*w=1600 1600w$/,
      );
    }
  });

  it('credits each photograph with its author and licence, and says when they are not stated', () => {
    const things = [thing('Q1', 'A.jpg'), thing('Q2', 'B.jpg'), thing('Q3', 'C.jpg')];
    const frames = slideshowFrames({
      code: 'ZZZ',
      name: 'Nowhere',
      outcome: ok(things, {
        'A.jpg': {
          author: 'Jane Doe',
          licence: 'CC BY-SA 4.0',
          pageUrl: 'https://commons.wikimedia.org/wiki/File:A.jpg',
        },
      }),
    })!;

    expect(frames[0]!.credit).toEqual({
      text: 'Jane Doe, CC BY-SA 4.0',
      href: 'https://commons.wikimedia.org/wiki/File:A.jpg',
    });
    expect(frames[1]!.credit.text).toBe('photographer not stated, licence not stated');
    expect(frames[1]!.credit.href).toBe('https://commons.wikimedia.org/wiki/File:B.jpg');
  });
});
