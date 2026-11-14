import { describe, expect, it } from 'vitest';
import { money } from '@/core/money';
import {
  parseAmount,
  parseContactForm,
  parseExpenseForm,
  parsePlanItemForm,
  parseTripForm,
} from './parse';

function form(entries: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(entries)) data.set(key, value);
  return data;
}

describe('parseAmount', () => {
  it('reads exactly what was typed, with no float in between', () => {
    expect(parseAmount('12.50', 'eur')).toEqual({ ok: true, value: money(1250, 'EUR') });
    expect(parseAmount('0.1', 'EUR')).toEqual({ ok: true, value: money(10, 'EUR') });
    expect(parseAmount('19.99', 'EUR')).toEqual({ ok: true, value: money(1999, 'EUR') });
    expect(parseAmount('1,5', 'EUR')).toEqual({ ok: true, value: money(150, 'EUR') });
    expect(parseAmount('500', 'JPY')).toEqual({ ok: true, value: money(500, 'JPY') });
    expect(parseAmount('1.234', 'KWD')).toEqual({ ok: true, value: money(1234, 'KWD') });
  });

  it('refuses more decimals than the currency has instead of rounding', () => {
    expect(parseAmount('1.005', 'EUR').ok).toBe(false);
    expect(parseAmount('1.5', 'JPY').ok).toBe(false);
  });

  it('refuses negatives, junk, empty text and a bad currency', () => {
    for (const bad of ['-5', 'abc', '', '1e3', '1.2.3', '12 EUR']) {
      expect(parseAmount(bad, 'EUR').ok).toBe(false);
    }
    expect(parseAmount('5', 'EURO').ok).toBe(false);
    expect(parseAmount('5', '').ok).toBe(false);
  });
});

describe('parseTripForm', () => {
  const valid = {
    name: 'Spring',
    destination: 'Lisbon',
    ownerName: 'Ana',
    destinationCountry: 'pt',
    startDate: '2026-04-10',
    endDate: '2026-04-12',
  };

  it('accepts a complete form and upper-cases the country', () => {
    const result = parseTripForm(form(valid));
    expect(result).toMatchObject({ ok: true, value: { destinationCountry: 'PT' } });
  });

  it('accepts a one-day trip but not one that ends before it starts', () => {
    expect(parseTripForm(form({ ...valid, endDate: '2026-04-10' })).ok).toBe(true);
    expect(parseTripForm(form({ ...valid, endDate: '2026-04-09' })).ok).toBe(false);
  });

  it('allows blank dates and country, rejects an unknown country or impossible date', () => {
    expect(
      parseTripForm(form({ ...valid, startDate: '', endDate: '', destinationCountry: '' })).ok,
    ).toBe(true);
    expect(parseTripForm(form({ ...valid, destinationCountry: 'ZZ' })).ok).toBe(false);
    expect(parseTripForm(form({ ...valid, startDate: '2026-02-30' })).ok).toBe(false);
    expect(parseTripForm(form({ ...valid, name: '  ' })).ok).toBe(false);
  });
});

describe('parsePlanItemForm', () => {
  const base = { kind: 'flight', title: 'LIS', status: 'planned' };

  it('combines a date and time into a local date-time and keeps the date in step', () => {
    const result = parsePlanItemForm(form({ ...base, date: '2026-04-10', time: '14:30' }));
    expect(result).toMatchObject({
      ok: true,
      value: { date: '2026-04-10', startsAt: '2026-04-10T14:30' },
    });
  });

  it('refuses a time without a date, and an impossible time', () => {
    expect(parsePlanItemForm(form({ ...base, time: '14:30' })).ok).toBe(false);
    expect(parsePlanItemForm(form({ ...base, date: '2026-04-10', time: '25:00' })).ok).toBe(false);
  });

  it('reads a price into Money and defaults the status to idea', () => {
    const result = parsePlanItemForm(
      form({ kind: 'stay', title: 'Hotel', price: '80.5', currency: 'EUR' }),
    );
    expect(result).toMatchObject({
      ok: true,
      value: { price: money(8050, 'EUR'), status: 'idea' },
    });
  });

  it('refuses an unknown kind or status', () => {
    expect(parsePlanItemForm(form({ ...base, kind: 'boat' })).ok).toBe(false);
    expect(parsePlanItemForm(form({ ...base, status: 'confirmed' })).ok).toBe(false);
  });
});

describe('parseExpenseForm', () => {
  const ids = ['m1', 'm2'];
  const base = {
    paidBy: 'm1',
    description: 'Dinner',
    date: '2026-04-10',
    amount: '30.01',
    currency: 'EUR',
  };

  it('reads an equal split from the ticked members', () => {
    const result = parseExpenseForm(
      form({ ...base, splitKind: 'equal', 'include:m1': 'on', 'include:m2': 'on' }),
      ids,
    );
    expect(result).toMatchObject({
      ok: true,
      value: { amount: money(3001, 'EUR'), split: { kind: 'equal', memberIds: ['m1', 'm2'] } },
    });
  });

  it('refuses an equal split with nobody ticked', () => {
    expect(parseExpenseForm(form({ ...base, splitKind: 'equal' }), ids).ok).toBe(false);
  });

  it('reads shares and refuses fractions or all-zero', () => {
    expect(
      parseExpenseForm(
        form({ ...base, splitKind: 'shares', 'weight:m1': '2', 'weight:m2': '1' }),
        ids,
      ).ok,
    ).toBe(true);
    expect(
      parseExpenseForm(form({ ...base, splitKind: 'shares', 'weight:m1': '1.5' }), ids).ok,
    ).toBe(false);
    expect(parseExpenseForm(form({ ...base, splitKind: 'shares', 'weight:m1': '0' }), ids).ok).toBe(
      false,
    );
  });

  it('accepts exact amounts only when they add up to the total', () => {
    const exact = (a: string, b: string) =>
      parseExpenseForm(form({ ...base, splitKind: 'exact', 'exact:m1': a, 'exact:m2': b }), ids);
    expect(exact('10.00', '20.01').ok).toBe(true);
    expect(exact('10.00', '20.00').ok).toBe(false);
    expect(exact('10.00', '20.02').ok).toBe(false);
  });

  it('refuses a payer who is not a member, a zero amount and a missing split kind', () => {
    expect(parseExpenseForm(form({ ...base, paidBy: 'x', splitKind: 'equal' }), ids).ok).toBe(
      false,
    );
    expect(
      parseExpenseForm(form({ ...base, amount: '0', splitKind: 'equal', 'include:m1': 'on' }), ids)
        .ok,
    ).toBe(false);
    expect(parseExpenseForm(form(base), ids).ok).toBe(false);
  });
});

describe('parseContactForm', () => {
  it('accepts an international number', () => {
    expect(
      parseContactForm(form({ name: 'Mum', phone: '+44 20 7946 0000', relation: 'Parent' })).ok,
    ).toBe(true);
  });

  it('refuses text, too-short and too-long numbers', () => {
    for (const phone of ['call me', '123', '1234567890123456', '']) {
      expect(parseContactForm(form({ name: 'Mum', phone, relation: 'Parent' })).ok).toBe(false);
    }
  });
});
