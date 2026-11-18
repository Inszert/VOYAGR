// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { compareAgainst } from '@/core/stay/comparison';
import type { CanonicalStay } from '@/core/stay/identity';
import type { StayProperty, StayRate } from '@/core/stay/types';
import { RateComparison } from './rate-comparison';
import { StayProperty as StayPropertyView } from './stay-property';

const property: StayProperty = {
  id: 'p1',
  providerPropertyId: 'p1',
  name: 'Hotel Lisboa',
  description: null,
  photos: [{ url: 'http://static.cupid.travel/a.jpg', caption: null }],
  address: { line: '1 Rua Augusta', city: 'Lisbon', countryCode: 'PT' },
  position: null,
  starRating: 4,
  guestRating: { outOfTen: 8.6, reviewCount: 120 },
  amenities: [],
  propertyType: 'hotel',
} as unknown as StayProperty;

function rate(id: string, over: Partial<StayRate> = {}): StayRate {
  return {
    id,
    providerRateId: id,
    providerRoomId: null,
    roomName: 'Double room',
    bedConfiguration: null,
    board: 'room_only',
    cancellation: { refundable: true, deadline: null, description: null },
    paymentTiming: 'pay_now',
    benefits: [],
    total: { amount: 30000, currency: 'EUR' },
    perNight: { amount: 10000, currency: 'EUR' },
    base: null,
    taxesAndFees: null,
    payableAtProperty: null,
    occupancy: { adults: 2, children: 0, rooms: 1 },
    observedAt: '2027-01-01T00:00:00.000Z',
    expiresAt: null,
    source: { providerId: 'liteapi', displayName: 'LiteAPI' },
    ...over,
  } as unknown as StayRate;
}

const stay = { key: 'k', property, offers: [] } as unknown as CanonicalStay;

describe('StayProperty', () => {
  it('makes the hotel name the h1 and states the facts in words', () => {
    render(
      <StayPropertyView
        stay={stay}
        backHref="/stays"
        locator={null}
        distanceLabel="1.2 km from the centre"
      />,
    );
    expect(screen.getByRole('heading', { level: 1, name: 'Hotel Lisboa' })).toBeTruthy();
    expect(screen.getByText('Four-star')).toBeTruthy();
    expect(screen.getByText('8.6 out of 10 (120 reviews)')).toBeTruthy();
    expect(screen.getByText('1.2 km from the centre')).toBeTruthy();
    // An http photo is never drawn.
    expect(screen.queryByRole('img')).toBeNull();
  });
});

describe('RateComparison', () => {
  const chosen = rate('a');
  const other = rate('b', {
    board: 'breakfast',
    cancellation: { refundable: false, deadline: null, description: null },
  });
  const comparison = compareAgainst(chosen, [chosen, other]);

  it('offers Choose this room on a rate that is not chosen, and says when terms differ', () => {
    render(
      <RateComparison comparison={comparison} hrefFor={(e) => `/stays?reference=${e.rate.id}`} />,
    );
    const links = screen.getAllByRole('link', { name: 'Choose this room' });
    expect(links).toHaveLength(1);
    expect(links[0]!.getAttribute('href')).toBe('/stays?reference=b');
    expect(screen.getByText(/Not the same offer:/)).toBeTruthy();
    expect(screen.getByText('Non-refundable')).toBeTruthy();
  });

  it('has no Check price button on any row', () => {
    render(<RateComparison comparison={comparison} hrefFor={() => '/x'} />);
    expect(screen.queryByRole('button', { name: /check price/i })).toBeNull();
  });

  it('omits the note when the terms are the same', () => {
    const same = compareAgainst(chosen, [chosen, rate('c')]);
    render(<RateComparison comparison={same} hrefFor={() => '/x'} />);
    expect(screen.queryByText(/Not the same offer/)).toBeNull();
  });
});
