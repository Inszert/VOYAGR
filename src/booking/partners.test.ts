import { describe, expect, it } from 'vitest';
import {
  activePromo,
  isAllowedPartnerUrl,
  offersFor,
  offersForTrip,
  PARTNER_OFFERS,
  registryProblems,
  type PartnerOffer,
} from './partners';

const sample: PartnerOffer = {
  id: 'sample',
  category: 'transfer',
  partner: 'Sample',
  description: 'A sample offer.',
  url: 'https://sample.tpk.lv/abc',
};

describe('the seeded registry', () => {
  it('holds exactly the four live links and nothing invented', () => {
    expect(PARTNER_OFFERS.map((offer) => [offer.partner, offer.category, offer.url])).toEqual([
      ['Intui', 'transfer', 'https://intui.tpk.lv/fpeuqQrG'],
      ['AirHelp', 'compensation', 'https://airhelp.tpk.lv/pGWVqGU3'],
      ['Yesim', 'esim', 'https://yesim.tpk.lv/ecwWMBgq'],
      ['GigSky', 'esim', 'https://gigsky.tpk.lv/N27sJpgR'],
    ]);
  });

  it('passes its own validation', () => {
    expect(registryProblems(PARTNER_OFFERS)).toEqual([]);
  });

  it('carries no price and no promo it was not given', () => {
    for (const offer of PARTNER_OFFERS) {
      expect(Object.keys(offer)).not.toContain('price');
      expect(offer.promo).toBeUndefined();
      expect(offer.description).not.toMatch(/[€$£]|\d+\s?%|\bfrom\b.*\d/i);
    }
  });
});

describe('isAllowedPartnerUrl', () => {
  it.each([
    'https://intui.tpk.lv/fpeuqQrG',
    'https://tpk.lv/x',
    'https://tp.media/r?campaign_id=1',
    'https://c.tp.media/r',
  ])('accepts %s', (url) => {
    expect(isAllowedPartnerUrl(url)).toBe(true);
  });

  it.each([
    ['plain http', 'http://intui.tpk.lv/x'],
    ['javascript:', 'javascript:alert(1)'],
    ['another host', 'https://example.com/x'],
    ['a host that only ends in the same letters', 'https://evil-tpk.lv/x'],
    ['the allowed host as a prefix of another', 'https://tpk.lv.evil.example/x'],
    ['credentials hiding the real host', 'https://tpk.lv@evil.example/x'],
    ['credentials on an allowed host', 'https://user:pass@intui.tpk.lv/x'],
    ['a relative path', '/go/intui'],
    ['not a URL', 'not a url'],
    ['an empty string', ''],
  ])('rejects %s', (_label, url) => {
    expect(isAllowedPartnerUrl(url)).toBe(false);
  });
});

describe('registryProblems', () => {
  it('is empty for a sound registry, including an empty one', () => {
    expect(registryProblems([sample])).toEqual([]);
    expect(registryProblems([])).toEqual([]);
  });

  it('names a duplicate id', () => {
    expect(registryProblems([sample, sample])).toEqual(['sample: duplicate id']);
  });

  it('names a link that is off the allow-list', () => {
    expect(registryProblems([{ ...sample, url: 'https://example.com/x' }])).toEqual([
      'sample: url is not https on an allowed partner host',
    ]);
  });

  it('rejects a promo with no code or an impossible expiry', () => {
    expect(registryProblems([{ ...sample, promo: { code: ' ', expiresOn: null } }])).toEqual([
      'sample: promo has no code',
    ]);
    expect(
      registryProblems([{ ...sample, promo: { code: 'GO', expiresOn: '2026-02-30' } }]),
    ).toEqual(['sample: promo expiry is not a calendar date']);
  });

  it('rejects an empty "when", which would match nothing and look like a bug', () => {
    expect(registryProblems([{ ...sample, when: [] }])).toHaveLength(1);
  });
});

describe('offersFor', () => {
  it('returns every offer in a category, in registry order', () => {
    expect(offersFor('esim').map((offer) => offer.partner)).toEqual(['Yesim', 'GigSky']);
    expect(offersFor('transfer').map((offer) => offer.partner)).toEqual(['Intui']);
  });

  it.each(['car_rental', 'activities', 'insurance', 'rail_bus', 'luggage', 'stay'] as const)(
    'returns an empty list, not a placeholder, for %s',
    (category) => {
      expect(offersFor(category)).toEqual([]);
    },
  );
});

describe('offersForTrip', () => {
  it('returns everything when the context says nothing', () => {
    expect(offersForTrip()).toHaveLength(PARTNER_OFFERS.length);
    expect(offersForTrip({})).toHaveLength(PARTNER_OFFERS.length);
  });

  it('keeps only offers that share a moment with the context', () => {
    expect(offersForTrip({ moments: ['after_flight'] }).map((offer) => offer.partner)).toEqual([
      'AirHelp',
    ]);
    expect(offersForTrip({ moments: ['arrival'] }).map((offer) => offer.partner)).toEqual([
      'Intui',
      'Yesim',
      'GigSky',
    ]);
  });

  it('returns nothing for a moment no offer is for', () => {
    expect(offersForTrip({ moments: ['during'] })).toEqual([]);
  });

  it('treats an offer with no rule as relevant at every moment', () => {
    expect(offersForTrip({ moments: ['during'] }, [sample])).toEqual([sample]);
  });

  it('treats an empty list of moments as no moment at all', () => {
    expect(offersForTrip({ moments: [] })).toEqual([]);
    expect(offersForTrip({ moments: [] }, [sample])).toEqual([sample]);
  });

  it('narrows by category as well', () => {
    expect(offersForTrip({ categories: ['esim'] })).toHaveLength(2);
    expect(offersForTrip({ categories: ['esim'], moments: ['after_flight'] })).toEqual([]);
    expect(offersForTrip({ categories: ['insurance'] })).toEqual([]);
  });
});

describe('activePromo', () => {
  const withPromo = (expiresOn: string | null): PartnerOffer => ({
    ...sample,
    promo: { code: 'VOYAGR', expiresOn },
  });

  it('is null for an offer with no promo', () => {
    expect(activePromo(sample, '2026-11-14')).toBeNull();
  });

  it('returns a promo with no stated end on any day', () => {
    expect(activePromo(withPromo(null), '2099-01-01')?.code).toBe('VOYAGR');
  });

  it('returns the promo the day before it ends and on the day it ends', () => {
    expect(activePromo(withPromo('2026-12-31'), '2026-12-30')?.code).toBe('VOYAGR');
    expect(activePromo(withPromo('2026-12-31'), '2026-12-31')?.code).toBe('VOYAGR');
  });

  it('does not return a promo the day after it ends', () => {
    expect(activePromo(withPromo('2026-12-31'), '2027-01-01')).toBeNull();
  });

  it('compares across a month and a year boundary by date, not by digits', () => {
    expect(activePromo(withPromo('2026-02-28'), '2026-03-01')).toBeNull();
    expect(activePromo(withPromo('2026-12-31'), '2026-09-01')?.code).toBe('VOYAGR');
  });

  it('returns nothing when today is not a real date, rather than guessing it is live', () => {
    expect(activePromo(withPromo('2026-12-31'), '')).toBeNull();
    expect(activePromo(withPromo('2026-12-31'), '2026-13-01')).toBeNull();
  });
});
