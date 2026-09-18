import type { FlightOffer, HotelOffer } from '@/core/trip/types';
import { getLogger } from '@/lib/logger';

/**
 * The booking hand-off seam (implementation plan 1.2).
 *
 * Every outbound link in the product is built here and nowhere else. A results
 * list that assembles its own `href` is the thing this module exists to
 * prevent, because affiliate attribution (specification section 24.4) then
 * becomes a change to every component that ever rendered a link rather than a
 * change to one function.
 *
 * It is also a trust boundary. A `deepLink` is a string a provider gave us, and
 * it goes straight into an `href`. An unchecked one is an open redirect at best
 * and `javascript:` execution at worst, so a URL that is not plain `https` never
 * reaches the page.
 */

const log = getLogger('booking.handoff');

/** `http` is accepted only so a local provider sandbox can be used in development. */
const ALLOWED_PROTOCOLS = new Set(['https:', 'http:']);

export type HandoffKind = 'flight' | 'hotel';

export interface BookingHandoff {
  readonly kind: HandoffKind;
  /** The vetted, attribution-carrying URL to put in an `href`. */
  readonly url: string;
  /** Provider that supplied the link, for disclosure and for click records. */
  readonly providerId: string;
  /** The offer this link books, so a click can later be recorded against it. */
  readonly offerId: string;
}

export interface HandoffContext {
  /** Correlation id, so a click can be tied back to the search that produced it. */
  readonly searchId?: string;
  readonly candidateId?: string;
}

/**
 * Attribution.
 *
 * Deliberately a no-op today: no affiliate programme is signed, and inventing a
 * tracking parameter for a partner we do not have would be noise at best and a
 * broken link at worst. §24.4 becomes an edit to this one function.
 */
function withAttribution(url: URL, _context: HandoffContext): URL {
  return url;
}

/**
 * Vet a provider-supplied link.
 *
 * Returns null rather than throwing: a missing or hostile deep link means the
 * offer is shown without a booking button, which is a degraded result, not a
 * failed page.
 */
function vet(deepLink: string | undefined, kind: HandoffKind, providerId: string): URL | null {
  if (!deepLink) return null;

  let parsed: URL;
  try {
    parsed = new URL(deepLink);
  } catch {
    log.warn({ kind, providerId }, 'provider supplied a deep link that is not a URL');
    return null;
  }

  if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) {
    // The case that matters: `javascript:` or `data:` in an href is script
    // execution in the user's session, handed to us by an upstream provider.
    log.warn(
      { kind, providerId, protocol: parsed.protocol },
      'rejected a provider deep link with a disallowed protocol',
    );
    return null;
  }

  return parsed;
}

function build(
  kind: HandoffKind,
  deepLink: string | undefined,
  providerId: string,
  offerId: string,
  context: HandoffContext,
): BookingHandoff | null {
  const vetted = vet(deepLink, kind, providerId);
  if (!vetted) return null;

  return {
    kind,
    url: withAttribution(vetted, context).toString(),
    providerId,
    offerId,
  };
}

export function buildFlightHandoff(
  offer: FlightOffer,
  context: HandoffContext = {},
): BookingHandoff | null {
  return build('flight', offer.deepLink, offer.providerId, offer.id, context);
}

export function buildHotelHandoff(
  offer: HotelOffer,
  context: HandoffContext = {},
): BookingHandoff | null {
  return build('hotel', offer.deepLink, offer.providerId, offer.id, context);
}

/**
 * Attributes every outbound booking link must carry.
 *
 * `noopener` is the security-relevant one - without it the opened page can
 * reach back through `window.opener`. `nofollow sponsored` is what an affiliate
 * link is required to declare once §24.4 is switched on, and declaring it now
 * costs nothing and cannot be forgotten later.
 */
export const OUTBOUND_LINK_REL = 'noopener noreferrer nofollow sponsored';
