import { describe, expect, it } from 'vitest';
import catalogue from '../../../public/geo/label-places.v1.json';
import {
  chooseLabels,
  labelBudget,
  labelRect,
  LIMB_ENTER_COSINE,
  LIMB_EXIT_COSINE,
  parseLabelPlaces,
  placeLinkLabel,
  type ChooseLabelsInput,
  type LabelCandidate,
} from './globe-labels';

const region = { left: 0, top: 0, right: 1000, bottom: 800 };

function candidate(id: string, x: number, y: number, extra: Partial<LabelCandidate> = {}) {
  return { id, lng: x, lat: y, priced: false, order: 0, width: 80, height: 20, ...extra };
}

/** A flat test world: lng/lat are the screen position, and facing is a given cosine. */
function input(
  candidates: LabelCandidate[],
  overrides: Partial<ChooseLabelsInput> = {},
  facing: Record<string, number> = {},
): ChooseLabelsInput {
  return {
    candidates,
    project: (c) => ({ x: c.lng, y: c.lat }),
    cosine: (c) => facing[c.id] ?? 1,
    previous: new Set(),
    budget: 10,
    region,
    obstacles: [],
    ...overrides,
  };
}

describe('labelBudget', () => {
  it('grows from about five at rest to twelve and then twenty-four as the camera closes in', () => {
    expect(labelBudget(0, false)).toBe(5);
    expect(labelBudget(0.8, false)).toBe(12);
    expect(labelBudget(1.6, false)).toBe(24);
  });

  it('is smaller on a phone at every step', () => {
    for (const zoom of [0, 0.8, 1.6]) {
      expect(labelBudget(zoom, true)).toBeLessThan(labelBudget(zoom, false));
    }
  });
});

describe('chooseLabels', () => {
  it('places priced pins before any name, whatever their order', () => {
    const shown = chooseLabels(
      input(
        [
          candidate('name', 100, 100, { order: -9_000_000 }),
          candidate('price', 110, 100, { priced: true, order: 7 }),
        ],
        { budget: 1 },
      ),
    );

    expect([...shown.keys()]).toEqual(['price']);
  });

  it('never lets two labels overlap', () => {
    const shown = chooseLabels(
      input([candidate('a', 100, 100), candidate('b', 120, 105), candidate('c', 400, 100)]),
    );

    expect([...shown.keys()].sort()).toEqual(['a', 'c']);
  });

  it('keeps a label on screen against a newcomer that ranks above it', () => {
    const candidates = [
      candidate('big', 100, 100, { order: -2_000_000 }),
      candidate('small', 120, 100, { order: -100_000 }),
    ];

    // With nothing on screen the larger city wins the spot...
    expect([...chooseLabels(input(candidates)).keys()]).toEqual(['big']);
    // ...but once the smaller one holds it, it is not swapped out.
    expect([...chooseLabels(input(candidates, { previous: new Set(['small']) })).keys()]).toEqual([
      'small',
    ]);
  });

  it('needs a place well onto the face to gain a label, and keeps it until 12 degrees from the limb', () => {
    const near = { a: (LIMB_EXIT_COSINE + LIMB_ENTER_COSINE) / 2 };
    const one = [candidate('a', 100, 100)];

    expect(chooseLabels(input(one, {}, near)).has('a')).toBe(false);
    expect(chooseLabels(input(one, { previous: new Set(['a']) }, near)).has('a')).toBe(true);
    expect(
      chooseLabels(input(one, { previous: new Set(['a']) }, { a: LIMB_EXIT_COSINE - 0.01 })).has(
        'a',
      ),
    ).toBe(false);
  });

  it('stops at the budget, but an unlimited pin still gets through', () => {
    const many = [0, 1, 2, 3].map((i) => candidate(`n${i}`, 100 + i * 200, 100, { order: i }));
    expect(chooseLabels(input(many, { budget: 2 })).size).toBe(2);

    const withPin = [...many, candidate('pin', 100, 400, { priced: true })];
    const shown = chooseLabels(input(withPin, { budget: 2, pricedUnlimited: true }));
    expect(shown.has('pin')).toBe(true);
    expect(shown.size).toBe(3);
  });

  it('turns a label round rather than letting it run out of the region', () => {
    const shown = chooseLabels(input([candidate('edge', 960, 100)]));
    expect(shown.get('edge')?.left).toBe(true);
  });

  it('keeps clear of whatever is laid over the globe', () => {
    const shown = chooseLabels(
      input([candidate('under', 100, 100)], {
        obstacles: [{ left: 50, top: 50, right: 300, bottom: 150 }],
      }),
    );
    expect(shown.size).toBe(0);
  });

  it('skips a point that is not on screen', () => {
    const shown = chooseLabels(input([candidate('gone', 100, 100)], { project: () => null }));
    expect(shown.size).toBe(0);
  });
});

describe('labelRect', () => {
  it('puts the dot on the coordinate, whichever way the words read', () => {
    expect(labelRect(100, 50, 80, 20, false)).toEqual({
      left: 95,
      right: 175,
      top: 40,
      bottom: 60,
    });
    expect(labelRect(100, 50, 80, 20, true).right).toBe(105);
  });
});

describe('the place catalogue', () => {
  const places = parseLabelPlaces(catalogue);

  it('parses every row of the generated file', () => {
    expect(places.length).toBe((catalogue as { rows: unknown[] }).rows.length);
    expect(places.length).toBeGreaterThan(1500);
  });

  it('has a first tier for globe zoom and a larger second tier for closer in', () => {
    const tierOne = places.filter((place) => place.tier === 1).length;
    const tierTwo = places.filter((place) => place.tier === 2).length;
    expect(tierOne).toBeGreaterThan(300);
    expect(tierTwo).toBeGreaterThan(tierOne);
  });

  it('names a city once, by the airport a search would take', () => {
    const keys = places.map((place) => `${place.country}:${place.city}`);
    expect(new Set(keys).size).toBe(keys.length);
    expect(places.find((place) => place.city === 'Vienna')?.code).toBe('VIE');
  });

  it('drops a row that is not the stated shape', () => {
    expect(
      parseLabelPlaces({
        rows: [
          ['BTS', 'Bratislava', 'Slovakia', 17.12, 48.15, 423737, 1],
          ['bts', 'x', null, 0, 0, 0, 1],
          ['ABC', 'Nowhere', null, 400, 0, 0, 1],
          ['ABD', 'Tierless', null, 0, 0, 0, 3],
        ],
      }).map((place) => place.code),
    ).toEqual(['BTS']);
    expect(parseLabelPlaces(null)).toEqual([]);
  });

  it('words its link as a question about prices, never as a figure', () => {
    expect(placeLinkLabel({ city: 'Košice', country: 'Slovakia' })).toBe(
      'See prices for Košice, Slovakia',
    );
    expect(placeLinkLabel({ city: 'Somewhere', country: null })).toBe('See prices for Somewhere');
  });
});
