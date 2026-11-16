import { describe, expect, it } from 'vitest';
import { money } from '@/core/money';
import type { CanonicalStay } from '@/core/stay/identity';
import type { ValidatedStayListing } from '@/providers/schema';
import { clusterPins } from './pin-clusters';
import { buildStayRows } from './stay-rows';

const centre = { latitude: 41.39, longitude: 2.17 };

function listing(id: number, name: string, latitude: number, longitude: number) {
  return {
    id: `osm:node/${id}`,
    providerId: 'osm-stays',
    name,
    kind: 'hotel',
    latitude,
    longitude,
    stars: null,
    address: null,
    website: null,
  } satisfies ValidatedStayListing;
}

function priced(key: string, name: string, latitude: number, longitude: number): CanonicalStay {
  const total = money(48_000, 'EUR');
  return {
    key,
    property: {
      id: key,
      providerPropertyId: key,
      name,
      description: null,
      photos: [],
      address: { line: null, city: null, region: null, postcode: null, countryCode: null },
      position: { latitude, longitude },
      starRating: 4,
      guestRating: null,
      amenities: [],
      propertyType: 'hotel',
    },
    offers: [
      {
        property: {} as never,
        rates: [
          {
            id: `${key}:r`,
            providerRateId: 'r',
            providerRoomId: null,
            roomName: null,
            bedConfiguration: null,
            board: null,
            cancellation: { refundable: null, deadline: null, description: null },
            paymentTiming: null,
            benefits: [],
            total,
            perNight: money(12_000, 'EUR'),
            base: null,
            taxesAndFees: null,
            occupancy: { adults: 2, children: 0, rooms: 1 },
            observedAt: '2026-01-15T09:00:00Z',
            expiresAt: null,
            source: {
              part: 'stays',
              providerId: 'mock',
              displayName: 'Mock',
              provenance: 'mock',
            },
          },
        ],
      },
    ],
  } as CanonicalStay;
}

const base = {
  centre,
  nights: 4,
  compareHref: (key: string) => `/stays?property=${key}`,
  partnerHref: () => null,
};

describe('buildStayRows', () => {
  it('gives a listed hotel a price only when a priced provider quoted that hotel', () => {
    const rows = buildStayRows({
      ...base,
      stays: [priced('arts', 'Hotel Arts', 41.3869, 2.1962)],
      listings: [listing(1, 'Hotel Arts', 41.387, 2.1963), listing(2, 'Hostal Nou', 41.39, 2.171)],
    });

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ name: 'Hotel Arts', link: { kind: 'compare' } });
    expect(rows[0]!.priceLabel).toMatch(/total · 4 nights/);
    expect(rows[1]).toMatchObject({ name: 'Hostal Nou', price: null, priceLabel: null });
  });

  it('measures every distance from the city centre and lists the unpriced nearest first', () => {
    const rows = buildStayRows({
      ...base,
      stays: [],
      listings: [listing(1, 'Far', 41.42, 2.17), listing(2, 'Near', 41.391, 2.17)],
    });
    expect(rows.map((row) => row.name)).toEqual(['Near', 'Far']);
    expect(rows[0]!.distanceLabel).toBe('0.1 km from the centre');
  });

  it('links an unpriced hotel to the partner search when there is one', () => {
    const rows = buildStayRows({
      ...base,
      stays: [],
      listings: [listing(1, 'Hostal Nou', 41.39, 2.171)],
      partnerHref: (name) => ({ href: `https://tp.media/r?u=${name}`, host: 'Booking.com' }),
    });
    expect(rows[0]!.link).toMatchObject({ kind: 'partner', host: 'Booking.com' });
  });
});

describe('clusterPins', () => {
  it('joins pins within the radius and keeps distant ones apart, in list order', () => {
    const clusters = clusterPins(
      [
        { id: 'a', x: 0, y: 0 },
        { id: 'b', x: 10, y: 10 },
        { id: 'c', x: 200, y: 0 },
      ],
      34,
    );
    expect(clusters.map((cluster) => cluster.members)).toEqual([['a', 'b'], ['c']]);
    expect(clusters[0]!.id).toBe('a');
  });
});
