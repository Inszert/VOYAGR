import { describe, expect, it, vi } from 'vitest';
import { MemoryCacheStore } from '@/cache/memory';
import { err, ok } from '@/lib/result';
import { AppError } from '@/lib/errors';
import { createMockPlacesProvider } from '@/providers/places/mock';
import { createAbsentPlacesProvider } from '@/providers/absent';
import type { PlacesProvider, ThingKind, ThingToDo } from '@/providers/types';
import {
  MAX_THINGS_SHOWN,
  THINGS_FRESH_MS,
  countsByKind,
  isThingsToDoFresh,
  loadThingsToDo,
  parseKind,
  placesToShow,
  warmThingsToDo,
} from './things-to-do';

function thing(id: number, kind: ThingKind, imageFile: string | null = null): ThingToDo {
  return {
    id: `Q${id}`,
    providerId: 'wikidata',
    name: `Place ${id}`,
    kind,
    description: null,
    latitude: 36.9,
    longitude: 30.7,
    distanceFromCentreMetres: id * 100,
    notability: 100 - id,
    wikipediaUrl: null,
    imageFile,
  };
}

const REQUEST = {
  destination: 'AYT',
  destinationName: 'Antalya',
  position: [30.79, 36.9] as const,
};

/** A live-looking provider whose answer and call count a test controls. */
function provider(answer: () => ReturnType<PlacesProvider['thingsToDo']>) {
  const thingsToDo = vi.fn(answer);
  const live: PlacesProvider = {
    metadata: {
      id: 'wikidata',
      kind: 'places',
      displayName: 'Wikidata',
      isMock: false,
      mode: 'live',
      rateLimitPerMinute: 10,
    },
    checkHealth: async () => ({
      status: 'healthy',
      checkedAt: '2026-01-01T00:00:00Z',
      latencyMs: 0,
    }),
    searchPlaces: async () => ok([]),
    thingsToDo,
  };

  return { live, thingsToDo };
}

describe('placesToShow', () => {
  const things = Array.from({ length: 40 }, (_, index) =>
    thing(index + 1, index % 2 === 0 ? 'sights' : 'museums'),
  );

  it('shows at most 30, best known first', () => {
    const shown = placesToShow(things, null);

    expect(shown).toHaveLength(MAX_THINGS_SHOWN);
    expect(shown[0]?.id).toBe('Q1');
  });

  it('shows exactly 30 when there are 30, and all of them when there are fewer', () => {
    expect(placesToShow(things.slice(0, 30), null)).toHaveLength(30);
    expect(placesToShow(things.slice(0, 31), null)).toHaveLength(30);
    expect(placesToShow(things.slice(0, 7), null)).toHaveLength(7);
    expect(placesToShow([], null)).toEqual([]);
  });

  it('filters by kind and keeps the order', () => {
    const museums = placesToShow(things, 'museums');

    expect(museums.every((place) => place.kind === 'museums')).toBe(true);
    expect(museums.map((place) => place.id).slice(0, 3)).toEqual(['Q2', 'Q4', 'Q6']);
  });

  it('counts each kind, with the kinds that are empty at zero', () => {
    expect(countsByKind(things)).toEqual({
      sights: 20,
      museums: 20,
      beaches: 0,
      outdoors: 0,
      neighbourhoods: 0,
      food: 0,
      culture: 0,
    });
  });
});

describe('parseKind', () => {
  it('accepts a known group and nothing else', () => {
    expect(parseKind('museums')).toBe('museums');
    expect(parseKind(['food', 'museums'])).toBe('food');
    expect(parseKind('Museums')).toBeNull();
    expect(parseKind('<script>')).toBeNull();
    expect(parseKind(undefined)).toBeNull();
    expect(parseKind('')).toBeNull();
  });
});

describe('loadThingsToDo', () => {
  it('asks the provider once and serves the second reader from the cache', async () => {
    const { live, thingsToDo } = provider(async () => ok([thing(1, 'sights')]));
    const store = new MemoryCacheStore();

    const first = await loadThingsToDo({ ...REQUEST, provider: live, store });
    const second = await loadThingsToDo({ ...REQUEST, provider: live, store });

    expect(thingsToDo).toHaveBeenCalledTimes(1);
    expect(first.status).toBe('ok');
    expect(second).toMatchObject({ status: 'ok', things: [{ id: 'Q1' }] });
  });

  it('shares one call between readers who arrive together', async () => {
    const { live, thingsToDo } = provider(async () => ok([thing(1, 'sights')]));
    const store = new MemoryCacheStore();

    await Promise.all([
      loadThingsToDo({ ...REQUEST, provider: live, store }),
      loadThingsToDo({ ...REQUEST, provider: live, store }),
      loadThingsToDo({ ...REQUEST, provider: live, store }),
    ]);

    expect(thingsToDo).toHaveBeenCalledTimes(1);
  });

  it('degrades to "unavailable" when the source fails, and does not cache the failure', async () => {
    let healthy = false;
    const { live, thingsToDo } = provider(async () =>
      healthy ? ok([thing(1, 'sights')]) : err(new AppError('PROVIDER_UNAVAILABLE', 'down')),
    );
    const store = new MemoryCacheStore();

    expect(await loadThingsToDo({ ...REQUEST, provider: live, store })).toEqual({
      status: 'unavailable',
    });

    healthy = true;
    expect((await loadThingsToDo({ ...REQUEST, provider: live, store })).status).toBe('ok');
    expect(thingsToDo).toHaveBeenCalledTimes(2);
  });

  it('never throws, even when the provider does', async () => {
    const { live } = provider(async () => {
      throw new Error('boom');
    });

    expect(
      await loadThingsToDo({ ...REQUEST, provider: live, store: new MemoryCacheStore() }),
    ).toEqual({ status: 'unavailable' });
  });

  it('says "absent" when no data source is configured', async () => {
    const outcome = await loadThingsToDo({ ...REQUEST, provider: createAbsentPlacesProvider() });

    expect(outcome).toEqual({ status: 'absent' });
  });

  it('carries credits for the pictures, and survives the credit lookup failing', async () => {
    const { live } = provider(async () => ok([thing(1, 'sights', 'A.jpg'), thing(2, 'museums')]));
    const credit = {
      author: 'Jane',
      licence: 'CC BY 4.0',
      pageUrl: 'https://commons.wikimedia.org/wiki/File:A.jpg',
    };

    const withCredits = await loadThingsToDo({
      ...REQUEST,
      provider: live,
      store: new MemoryCacheStore(),
      fetchCredits: async () => ok(new Map([['A.jpg', credit]])),
    });
    const withoutCredits = await loadThingsToDo({
      ...REQUEST,
      provider: live,
      store: new MemoryCacheStore(),
      fetchCredits: async () => err(new AppError('PROVIDER_UNAVAILABLE', 'down')),
    });

    expect(withCredits).toMatchObject({ credits: { 'A.jpg': credit } });
    expect(withoutCredits).toMatchObject({ status: 'ok', credits: {} });
  });

  it('marks fixtures as samples', async () => {
    const outcome = await loadThingsToDo({
      ...REQUEST,
      provider: createMockPlacesProvider(),
      store: new MemoryCacheStore(),
    });

    expect(outcome.status === 'ok' && outcome.sample).toBe(true);
  });
});

describe('warmThingsToDo', () => {
  it('fills the cache so the first visitor is served without a provider call', async () => {
    const { live, thingsToDo } = provider(async () => ok([thing(1, 'sights')]));
    const store = new MemoryCacheStore();

    expect(await warmThingsToDo({ ...REQUEST, provider: live, store })).toBe('warmed');
    const outcome = await loadThingsToDo({ ...REQUEST, provider: live, store });

    expect(thingsToDo).toHaveBeenCalledTimes(1);
    expect(outcome).toMatchObject({ status: 'ok', things: [{ id: 'Q1' }] });
  });

  it('leaves a fresh entry alone', async () => {
    const { live, thingsToDo } = provider(async () => ok([thing(1, 'sights')]));
    const store = new MemoryCacheStore();

    await warmThingsToDo({ ...REQUEST, provider: live, store });

    expect(await isThingsToDoFresh({ ...REQUEST, provider: live, store })).toBe(true);
    expect(await warmThingsToDo({ ...REQUEST, provider: live, store })).toBe('fresh');
    expect(thingsToDo).toHaveBeenCalledTimes(1);
  });

  it('is fresh for exactly a week and not a millisecond longer', async () => {
    const { live, thingsToDo } = provider(async () => ok([thing(1, 'sights')]));
    const clock = { at: Date.parse('2026-11-01T00:00:00.000Z') };
    const store = new MemoryCacheStore({ now: () => clock.at });

    await warmThingsToDo({ ...REQUEST, provider: live, store });

    clock.at += THINGS_FRESH_MS;
    expect(await isThingsToDoFresh({ ...REQUEST, provider: live, store }, () => clock.at)).toBe(
      true,
    );

    clock.at += 1;
    expect(await isThingsToDoFresh({ ...REQUEST, provider: live, store }, () => clock.at)).toBe(
      false,
    );
    expect(thingsToDo).toHaveBeenCalledTimes(1);
  });

  it('is not fresh when nothing is cached', async () => {
    const { live } = provider(async () => ok([]));

    expect(
      await isThingsToDoFresh({ ...REQUEST, provider: live, store: new MemoryCacheStore() }),
    ).toBe(false);
  });

  it('throws when the source fails, so the job retries, and caches nothing', async () => {
    const { live } = provider(async () => err(new AppError('PROVIDER_UNAVAILABLE', 'down')));
    const store = new MemoryCacheStore();

    await expect(warmThingsToDo({ ...REQUEST, provider: live, store })).rejects.toThrow('down');
    expect(store.size).toBe(0);
  });

  it('does nothing for an absent slot, and counts it as not needing a round', async () => {
    const absent = createAbsentPlacesProvider();

    expect(await warmThingsToDo({ ...REQUEST, provider: absent })).toBe('absent');
    expect(await isThingsToDoFresh({ ...REQUEST, provider: absent })).toBe(true);
  });
});
