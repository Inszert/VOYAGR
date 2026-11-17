import type { StayProperty, StayRate } from '@/core/stay/types';

/** Fixtures for the snapshot tests: one mapped property and one mapped rate. */
export const aProperty: StayProperty = {
  id: 'liteapi:lp1001',
  providerPropertyId: 'lp1001',
  name: 'Hotel Alfama',
  description: null,
  photos: [{ url: 'https://example.invalid/a.jpg', caption: null }],
  address: { line: 'Rua A 1', city: 'Lisbon', region: null, postcode: null, countryCode: 'PT' },
  position: { latitude: 38.71, longitude: -9.13 },
  starRating: 4,
  guestRating: { score: 8.4, scale: 10, outOfTen: 8.4, reviewCount: 120 },
  amenities: [],
  propertyType: null,
};

export const aRate: StayRate = {
  id: 'liteapi:lp1001:offer-1',
  providerRateId: 'offer-1',
  providerRoomId: null,
  roomName: 'Double',
  bedConfiguration: null,
  board: 'breakfast',
  cancellation: { refundable: true, deadline: '2027-02-05T02:00:00Z', description: null },
  paymentTiming: 'pay_later',
  benefits: [],
  total: { amount: 33333, currency: 'EUR' },
  perNight: { amount: 8333, currency: 'EUR' },
  base: null,
  taxesAndFees: { amount: 1200, currency: 'EUR' },
  payableAtProperty: { amount: 400, currency: 'EUR' },
  occupancy: { adults: 2, children: 0, rooms: 1 },
  observedAt: '2027-01-10T08:00:00.000Z',
  expiresAt: null,
  source: { part: 'stays', providerId: 'liteapi', displayName: 'LiteAPI', provenance: 'test' },
};
