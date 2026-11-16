import { describe, expect, it } from 'vitest';
import { parsePriceText } from './price-text';

const read = (text: string, hint?: string) => {
  const parsed = parsePriceText(text, hint);
  return parsed ? `${parsed.amount} ${parsed.currency}` : null;
};

describe('parsePriceText', () => {
  it('reads a symbol in front, a symbol behind and a dollar', () => {
    expect(read('€1,234')).toBe('123400 EUR');
    expect(read('1 234 €')).toBe('123400 EUR');
    expect(read('$99')).toBeNull(); // which dollar? nobody said
    expect(read('$99', 'USD')).toBe('9900 USD');
    expect(read('£54')).toBe('5400 GBP');
  });

  it('treats no-break and thin spaces as digit groups', () => {
    expect(read('1 234 €')).toBe('123400 EUR');
    expect(read('1 234 EUR')).toBe('123400 EUR');
  });

  it('reads European and English decimals exactly, without a float', () => {
    expect(read('1.234,56 €')).toBe('123456 EUR');
    expect(read('€1,234.56')).toBe('123456 EUR');
    expect(read('12,5 €')).toBe('1250 EUR');
    expect(read('0.07', 'EUR')).toBe('7 EUR');
    // 0.1 + 0.2 style traps never arise: the digits are never a float.
    expect(read('1.15', 'EUR')).toBe('115 EUR');
  });

  it('reads a bare integer string, which is what the sidecar sends', () => {
    expect(read('189', 'EUR')).toBe('18900 EUR');
    expect(read('189', 'JPY')).toBe('189 JPY');
  });

  it('refuses what it cannot read exactly instead of rounding', () => {
    expect(read('12.345,6789', 'EUR')).toBeNull();
    expect(read('1.5', 'JPY')).toBeNull(); // JPY has no minor digits
    expect(read('12.3456', 'EUR')).toBeNull();
    expect(read('1,23,456', 'EUR')).toBeNull();
    expect(read('1.234.5', 'EUR')).toBeNull();
  });

  it('refuses a three-digit tail on a three-decimal currency as ambiguous', () => {
    expect(read('1,234', 'KWD')).toBeNull();
    expect(read('1,234', 'EUR')).toBe('123400 EUR');
    expect(read('1.2', 'KWD')).toBe('1200 KWD');
  });

  it('refuses zero, negative, empty and non-numeric text', () => {
    for (const bad of [
      '',
      '   ',
      '0',
      '€0',
      '-5',
      '€-5',
      'free',
      'from €99!',
      '€',
      '1,',
      ',5',
      '1..2',
    ]) {
      expect(read(bad, 'EUR')).toBeNull();
    }
  });

  it('refuses a price whose symbol disagrees with the stated currency', () => {
    expect(read('€99', 'USD')).toBeNull();
    expect(read('$99', 'EUR')).toBeNull();
    expect(read('$99', 'CAD')).toBe('9900 CAD');
    expect(read('EUR 99', 'GBP')).toBeNull();
    expect(read('€ 99 $', 'EUR')).toBeNull();
  });

  it('refuses an amount beyond what a safe integer can hold', () => {
    expect(read('99999999999999999999', 'EUR')).toBeNull();
  });

  it('refuses a malformed currency hint', () => {
    expect(read('99', 'EURO')).toBeNull();
    expect(read('99')).toBeNull();
  });
});
