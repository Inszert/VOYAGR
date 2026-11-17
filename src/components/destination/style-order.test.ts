import { describe, expect, it } from 'vitest';
import type { ThingKind } from '@/providers/types';
import { orderByStyle, parseStyle, withStyleParam } from './style-order';

const p = (id: string, kind: ThingKind) => ({ id, kind });
const PLACES = [
  p('a', 'museums'),
  p('b', 'food'),
  p('c', 'beaches'),
  p('d', 'sights'),
  p('e', 'outdoors'),
  p('f', 'food'),
  p('g', 'neighbourhoods'),
  p('h', 'culture'),
];
const ids = (list: { id: string }[]) => list.map((x) => x.id).join('');

describe('orderByStyle', () => {
  it('keeps the current order with no style', () => {
    expect(ids(orderByStyle(PLACES, null))).toBe('abcdefgh');
  });

  it('puts the style kinds first in the style order, the rest after as they were', () => {
    expect(ids(orderByStyle(PLACES, 'chill'))).toBe('ceh' + 'abdfg');
    expect(ids(orderByStyle(PLACES, 'hike'))).toBe('ed' + 'abcfgh');
    expect(ids(orderByStyle(PLACES, 'city'))).toBe('dahg' + 'bcef');
    expect(ids(orderByStyle(PLACES, 'food'))).toBe('bfg' + 'acdeh');
  });

  it('never removes or adds a place, and does not change the input', () => {
    const before = ids(PLACES);
    for (const style of ['chill', 'hike', 'city', 'food'] as const) {
      expect(ids(orderByStyle(PLACES, style)).split('').sort().join('')).toBe('abcdefgh');
    }
    expect(ids(PLACES)).toBe(before);
  });
});

describe('parseStyle', () => {
  it('accepts the four and nothing else', () => {
    expect(parseStyle('food')).toBe('food');
    expect(parseStyle(['hike', 'city'])).toBe('hike');
    expect(parseStyle('beach')).toBeNull();
    expect(parseStyle(undefined)).toBeNull();
  });
});

describe('withStyleParam', () => {
  it('sets, replaces and removes style, keeping the rest and the hash', () => {
    expect(withStyleParam('?kind=food#things-heading', 'city')).toBe(
      '?kind=food&style=city#things-heading',
    );
    expect(withStyleParam('?style=hike&a=1#x', 'food')).toBe('?style=food&a=1#x');
    expect(withStyleParam('?style=hike#x', null)).toBe('?#x');
  });
});
