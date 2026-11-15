import { describe, expect, it } from 'vitest';
import { fullCountryName, pickMoment, type HomeCard } from './card-data';

function makeCard(code: string, overrides: Partial<HomeCard> = {}): HomeCard {
  return {
    code,
    name: code,
    country: 'Testland',
    label: 'from EUR 400.00',
    href: '/',
    actionLabel: 'Show only trips to',
    aboutHref: '/',
    reason: '',
    weather: null,
    bestScore: 70,
    savings: null,
    image: { kind: 'local', blur: 'data:' },
    ...overrides,
  };
}

describe('fullCountryName', () => {
  it('never returns a bare two-letter code', () => {
    expect(fullCountryName('HK')).not.toBe('HK');
    expect(fullCountryName('HK').length).toBeGreaterThan(2);
    expect(fullCountryName('ES')).toBe('Spain');
  });

  it('leaves a name that is already a name alone', () => {
    expect(fullCountryName('Czech Republic')).toBe('Czech Republic');
  });
});

describe('pickMoment', () => {
  it('takes the engine pick when it has a picture', () => {
    const cards = [makeCard('AAA', { bestScore: 90 }), makeCard('BBB', { bestScore: 95 })];

    expect(pickMoment(cards, 'AAA')).toMatchObject({ card: { code: 'AAA' }, isBest: true });
  });

  it('falls to the best-scored place with a picture, and does not call it best', () => {
    const cards = [
      makeCard('AAA', { bestScore: 90, image: null }),
      makeCard('BBB', { bestScore: 60 }),
      makeCard('CCC', { bestScore: 80 }),
    ];

    expect(pickMoment(cards, 'AAA')).toMatchObject({ card: { code: 'CCC' }, isBest: false });
  });

  it('keeps the engine pick as a plain tile when nothing has a picture', () => {
    const cards = [makeCard('AAA', { image: null }), makeCard('BBB', { image: null })];

    expect(pickMoment(cards, 'AAA')).toMatchObject({ card: { code: 'AAA' }, isBest: true });
  });

  it('is nothing when there is nothing to show', () => {
    expect(pickMoment([], null)).toBeNull();
  });
});
