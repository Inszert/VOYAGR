import { describe, expect, it } from 'vitest';
import { money } from '../money';
import { canonicalise, compareProperties, metresBetween, normaliseName } from './identity';
import {
  bestRateFor,
  cheapestRate,
  compareAgainst,
  differencesBetween,
  isComparable,
  ratesOf,
} from './comparison';
import type { StayOffer, StayProperty, StayRate } from './types';

const property = (over: Partial<StayProperty> = {}): StayProperty => ({
  id: 'p1',
  providerPropertyId: 'x1',
  name: 'Hotel Marina',
  description: null,
  photos: [],
  address: { line: null, city: 'Barcelona', region: null, postcode: null, countryCode: 'ES' },
  position: { latitude: 41.3851, longitude: 2.1734 },
  starRating: 4,
  guestRating: null,
  amenities: [],
  propertyType: 'hotel',
  ...over,
});

const rate = (over: Partial<StayRate> = {}): StayRate => ({
  id: 'r1',
  providerRateId: 'rate-1',
  providerRoomId: null,
  roomName: 'Double room',
  bedConfiguration: null,
  board: 'breakfast',
  cancellation: { refundable: true, deadline: null, description: null },
  paymentTiming: 'pay_later',
  benefits: [],
  total: money(52_000, 'EUR'),
  perNight: money(13_000, 'EUR'),
  base: null,
  taxesAndFees: null,
  payableAtProperty: null,
  occupancy: { adults: 2, children: 0, rooms: 1 },
  observedAt: '2026-06-01T09:00:00Z',
  expiresAt: null,
  source: { part: 'stays', providerId: 'duffel', displayName: 'Duffel', provenance: 'test' },
  ...over,
});

describe('identifying one property across providers', () => {
  it('reduces a name to what distinguishes it', () => {
    expect(normaliseName('Hôtel Arts, Barcelona')).toBe('hotel arts barcelona');
    expect(normaliseName('HOTEL ARTS BARCELONA')).toBe('hotel arts barcelona');
  });

  it('measures distance well enough to tell two buildings apart', () => {
    const a = { latitude: 41.3851, longitude: 2.1734 };
    const b = { latitude: 41.3861, longitude: 2.1734 };

    expect(metresBetween(a, b)).toBeGreaterThan(100);
    expect(metresBetween(a, b)).toBeLessThan(120);
  });

  it('merges the same name at the same coordinates', () => {
    expect(compareProperties(property(), property({ id: 'p2' }))).toBe('same');
  });

  it('refuses to merge the same name far apart', () => {
    // "Ibis Barcelona" is four different buildings.
    const far = property({ position: { latitude: 41.42, longitude: 2.24 } });

    expect(compareProperties(property(), far)).toBe('different');
  });

  it('refuses to merge different names at the same coordinates', () => {
    expect(compareProperties(property(), property({ name: 'Casa Antiga' }))).toBe('different');
  });

  it('will not merge on a name alone when coordinates are missing', () => {
    // An unmerged duplicate is visible and annoying. A wrong merge is a lie
    // about where somebody will sleep, and they cannot tell it happened.
    const noGeo = property({ position: null });

    expect(compareProperties(noGeo, property({ id: 'p2', position: null }))).toBe('possible');
    expect(
      canonicalise([
        { property: noGeo, rates: [rate()] },
        { property: property({ id: 'p2', position: null }), rates: [rate({ id: 'r2' })] },
      ]),
    ).toHaveLength(2);
  });

  it('groups one property with every provider offering it', () => {
    const offers: StayOffer[] = [
      { property: property(), rates: [rate()] },
      {
        property: property({
          id: 'p2',
          providerPropertyId: 'y7',
          description: 'A long description',
        }),
        rates: [
          rate({
            id: 'r2',
            source: {
              part: 'stays',
              providerId: 'b',
              displayName: 'Provider B',
              provenance: 'live',
            },
          }),
        ],
      },
    ];

    const [merged] = canonicalise(offers);

    expect(merged?.offers).toHaveLength(2);
    // Merging only ever adds information.
    expect(merged?.property.description).toBe('A long description');
  });
});

describe('comparing rates', () => {
  it('reports an absolute and a percentage difference', () => {
    const reference = rate({ total: money(52_000, 'EUR'), perNight: money(13_000, 'EUR') });
    const cheaper = rate({
      id: 'r2',
      total: money(49_800, 'EUR'),
      perNight: money(12_450, 'EUR'),
    });

    const [, other] = compareAgainst(reference, [reference, cheaper]);

    expect(other?.difference).toEqual(money(-2_200, 'EUR'));
    expect(other?.cheaper).toBe(true);
    // 2,200 of 52,000 is 4.2%.
    expect(other?.fraction).toBeCloseTo(-0.0423, 4);
    expect(other?.perNightDifference).toEqual(money(-550, 'EUR'));
  });

  it('marks the reference as the reference', () => {
    const reference = rate();
    const [first] = compareAgainst(reference, [reference]);

    expect(first?.isReference).toBe(true);
    expect(first?.differences).toEqual([]);
  });

  it('works from whichever rate the user picked', () => {
    const duffel = rate({ id: 'd', total: money(52_000, 'EUR') });
    const other = rate({ id: 'b', total: money(49_800, 'EUR') });

    // Reference Duffel: the other is cheaper. Reference the other: Duffel is
    // dearer. The same two numbers, both times honestly.
    expect(compareAgainst(duffel, [other])[0]?.cheaper).toBe(true);
    expect(compareAgainst(other, [duffel])[0]?.cheaper).toBe(false);
  });

  it('refuses to compare across currencies rather than inventing a rate', () => {
    const [result] = compareAgainst(rate(), [rate({ id: 'r2', total: money(45_000, 'USD') })]);

    expect(result?.difference).toBeNull();
    expect(result?.fraction).toBeNull();
    expect(result?.cheaper).toBe(false);
  });

  it('flags a cheaper non-refundable room as not the same thing', () => {
    // The case the whole module exists for: 480 non-refundable against 520
    // refundable is not "40 cheaper".
    const refundable = rate({ total: money(52_000, 'EUR') });
    const saver = rate({
      id: 'r2',
      total: money(48_000, 'EUR'),
      cancellation: { refundable: false, deadline: null, description: null },
      board: 'room_only',
    });

    const [result] = compareAgainst(refundable, [saver]);

    expect(result?.cheaper).toBe(true);
    expect(result?.differences).toContain('cancellation');
    expect(result?.differences).toContain('board');
  });

  it('treats an unstated condition as a difference, not as agreement', () => {
    const known = rate();
    const unknown = rate({
      id: 'r2',
      cancellation: { refundable: null, deadline: null, description: null },
    });

    // Two rates nobody stated a policy for are not *known* to be equivalent.
    expect(isComparable(known, unknown)).toBe(false);
    expect(differencesBetween(known, unknown)).toContain('cancellation');
  });

  it('notices a different room, occupancy or number of rooms', () => {
    expect(differencesBetween(rate(), rate({ roomName: 'Suite' }))).toContain('room_type');
    expect(
      differencesBetween(rate(), rate({ occupancy: { adults: 3, children: 0, rooms: 1 } })),
    ).toContain('occupancy');
    expect(
      differencesBetween(rate(), rate({ occupancy: { adults: 2, children: 0, rooms: 2 } })),
    ).toContain('rooms');
  });

  it('calls two identical rates comparable', () => {
    expect(isComparable(rate(), rate({ id: 'r2' }))).toBe(true);
  });
});

describe('the cheapest option', () => {
  const flexible = rate({ id: 'flex', total: money(52_000, 'EUR') });
  const saver = rate({
    id: 'saver',
    total: money(48_000, 'EUR'),
    cancellation: { refundable: false, deadline: null, description: null },
  });

  it('finds the lowest price', () => {
    expect(cheapestRate([flexible, saver])?.id).toBe('saver');
  });

  it('can be restricted to rates worth comparing', () => {
    // Otherwise the headline price is a non-refundable room nobody wanted.
    expect(cheapestRate([flexible, saver], (r) => r.cancellation.refundable === true)?.id).toBe(
      'flex',
    );
  });

  it('has no answer when nothing qualifies', () => {
    expect(cheapestRate([], () => true)).toBeNull();
    expect(cheapestRate([flexible], () => false)).toBeNull();
  });

  it('leads a merged property with the best price across every provider', () => {
    const [stay] = canonicalise([
      { property: property(), rates: [flexible] },
      { property: property({ id: 'p2' }), rates: [saver] },
    ]);

    expect(ratesOf(stay!)).toHaveLength(2);
    expect(bestRateFor(stay!)?.id).toBe('saver');
  });
});
