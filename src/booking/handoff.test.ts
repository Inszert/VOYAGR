import { describe, expect, it } from 'vitest';
import { buildFlightOffer, buildHotelOffer } from '@/core/trip/test-support';
import {
  buildFlightHandoff,
  buildHotelHandoff,
  buildPartnerHandoff,
  buildStayLinkHandoff,
  OUTBOUND_LINK_REL,
} from './handoff';
import { PARTNER_OFFERS } from './partners';

/**
 * The hand-off seam is a trust boundary as much as an attribution seam: a
 * `deepLink` is a string an external provider supplied and it goes into an
 * `href`, so these tests are about what must never reach the page.
 */

describe('buildFlightHandoff', () => {
  it('passes through an https link', () => {
    const handoff = buildFlightHandoff(
      buildFlightOffer({ deepLink: 'https://example.invalid/book?id=7' }),
    );

    expect(handoff?.url).toBe('https://example.invalid/book?id=7');
    expect(handoff?.kind).toBe('flight');
  });

  it('carries the provider and offer, so a click can be recorded against them', () => {
    const offer = buildFlightOffer({ deepLink: 'https://example.invalid/book' });
    const handoff = buildFlightHandoff(offer, { candidateId: 'candidate-1' });

    expect(handoff?.providerId).toBe(offer.providerId);
    expect(handoff?.offerId).toBe(offer.id);
  });

  it('returns null when the provider supplied no link', () => {
    // A missing link degrades the card to "no booking button", not to an error.
    expect(buildFlightHandoff(buildFlightOffer({ deepLink: undefined }))).toBeNull();
  });

  it('rejects a javascript: link', () => {
    // The case that matters: script execution in the user's session, handed to
    // us by an upstream provider and rendered straight into an href.
    expect(
      buildFlightHandoff(buildFlightOffer({ deepLink: 'javascript:alert(document.cookie)' })),
    ).toBeNull();
  });

  it('rejects data: and file: links', () => {
    expect(
      buildFlightHandoff(buildFlightOffer({ deepLink: 'data:text/html,<script>x()</script>' })),
    ).toBeNull();
    expect(buildFlightHandoff(buildFlightOffer({ deepLink: 'file:///etc/passwd' }))).toBeNull();
  });

  it('rejects a string that is not a URL at all', () => {
    expect(buildFlightHandoff(buildFlightOffer({ deepLink: 'not a url' }))).toBeNull();
    expect(buildFlightHandoff(buildFlightOffer({ deepLink: '/relative/path' }))).toBeNull();
  });
});

describe('buildHotelHandoff', () => {
  it('vets a hotel link by the same rules', () => {
    expect(buildHotelHandoff(buildHotelOffer({ deepLink: 'https://example.invalid/h' }))?.url).toBe(
      'https://example.invalid/h',
    );
    expect(buildHotelHandoff(buildHotelOffer({ deepLink: 'javascript:void 0' }))).toBeNull();
  });
});

describe('buildStayLinkHandoff', () => {
  const offer = {
    id: 'l1',
    providerId: 'travelpayouts-links',
    displayName: 'Booking.com via Travelpayouts',
    destinationName: 'Barcelona',
    checkIn: '2026-06-10',
    checkOut: '2026-06-14',
    occupancy: { adults: 2, children: 0, rooms: 1 },
    price: null,
    url: 'https://tp.media/r?marker=1',
  } as const;

  it('vets a find-a-stay link by the same rules', () => {
    expect(buildStayLinkHandoff(offer)?.url).toBe('https://tp.media/r?marker=1');
    expect(buildStayLinkHandoff({ ...offer, url: 'javascript:void 0' })).toBeNull();
  });
});

describe('OUTBOUND_LINK_REL', () => {
  it('blocks window.opener access and declares the commercial relationship', () => {
    // noopener is the security-relevant one; nofollow and sponsored are what an
    // affiliate link has to declare once section 24.4 is switched on.
    expect(OUTBOUND_LINK_REL).toContain('noopener');
    expect(OUTBOUND_LINK_REL).toContain('noreferrer');
    expect(OUTBOUND_LINK_REL).toContain('nofollow');
    expect(OUTBOUND_LINK_REL).toContain('sponsored');
  });
});

describe('buildPartnerHandoff', () => {
  it('hands off every seeded partner on its own link, attributed to the partner', () => {
    for (const offer of PARTNER_OFFERS) {
      const handoff = buildPartnerHandoff(offer);

      expect(handoff?.url).toBe(offer.url);
      expect(handoff?.kind).toBe('partner');
      expect(handoff?.providerId).toBe(offer.partner);
      expect(handoff?.offerId).toBe(offer.id);
    }
  });

  it('refuses a link that is off the allow-list or not https', () => {
    const [offer] = PARTNER_OFFERS;

    expect(buildPartnerHandoff({ ...offer!, url: 'https://example.com/x' })).toBeNull();
    expect(buildPartnerHandoff({ ...offer!, url: 'http://intui.tpk.lv/x' })).toBeNull();
    expect(buildPartnerHandoff({ ...offer!, url: 'javascript:alert(1)' })).toBeNull();
  });
});
