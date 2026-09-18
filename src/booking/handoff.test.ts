import { describe, expect, it } from 'vitest';
import { buildFlightOffer, buildHotelOffer } from '@/core/trip/test-support';
import { buildFlightHandoff, buildHotelHandoff, OUTBOUND_LINK_REL } from './handoff';

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
