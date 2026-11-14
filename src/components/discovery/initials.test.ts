import { describe, expect, it } from 'vitest';
import { initials } from './initials';

describe('initials', () => {
  it('uses the first two letters of a one-word country', () => {
    expect(initials('Georgia')).toBe('GE');
    expect(initials('Japan')).toBe('JA');
  });

  it('uses the first letter of the first two words otherwise', () => {
    expect(initials('Solomon Islands')).toBe('SI');
    expect(initials('Czech Republic')).toBe('CR');
    expect(initials('Timor-Leste')).toBe('TL');
  });

  it('skips small joining words and accents', () => {
    expect(initials('Republic of Korea')).toBe('RK');
    expect(initials('Côte d’Ivoire')).toBe('CD');
  });

  it('is empty rather than wrong when there is nothing to read', () => {
    expect(initials('')).toBe('');
  });
});
