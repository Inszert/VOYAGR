import { isAfter, isIsoDate } from '@/core/dates';
import type { IsoDate } from '@/core/trip/types';
import { AppError } from '@/lib/errors';

/**
 * The partner registry (finish plan D16, D18).
 *
 * Everything a traveller needs that Voyagr does not sell itself - a transfer
 * from the airport, an eSIM, compensation for a delayed flight - is an
 * affiliate link-out to a partner, drawn as our own component and never as the
 * partner's embedded widget. This file is the whole list, as data, so adding a
 * partner is one entry here and no component changes.
 *
 * Pure: no I/O, no clock. "Today" is always passed in by a caller that owns one.
 *
 * **There is no price on a partner offer.** A partner quotes its own price on
 * its own site, at the moment of booking; one shown here would be a number we
 * made up or copied, and numbers belong to `src/core/`. If a provider ever
 * supplies one it arrives as `Money` through a provider adapter, not through
 * this registry - which is why the type has no field for it.
 */

export type PartnerCategory =
  | 'transfer'
  | 'esim'
  | 'compensation'
  | 'car_rental'
  | 'activities'
  | 'insurance'
  | 'rail_bus'
  | 'luggage'
  | 'stay';

/** The point in a trip at which an offer is useful. */
export type PartnerMoment = 'before_trip' | 'arrival' | 'during' | 'after_flight';

export interface PartnerPromo {
  readonly code: string;
  /** Last day the code works, inclusive. `null` when the partner states no end. */
  readonly expiresOn: IsoDate | null;
}

export interface PartnerOffer {
  readonly id: string;
  readonly category: PartnerCategory;
  /** The partner's name as the traveller knows it. */
  readonly partner: string;
  /** One plain line on what the traveller gets. No claim about price. */
  readonly description: string;
  /** The tracked affiliate link. Always `https`, always on `ALLOWED_PARTNER_HOSTS`. */
  readonly url: string;
  readonly promo?: PartnerPromo;
  /** When it is relevant. Absent means at any point in the trip. */
  readonly when?: readonly PartnerMoment[];
}

/**
 * Hosts an affiliate link may point at.
 *
 * An allow-list rather than "any https", because this list is edited by hand:
 * a mistyped or pasted link should fail a test, not go out in an `href`.
 */
export const ALLOWED_PARTNER_HOSTS: readonly string[] = ['tpk.lv', 'tp.media'];

export const PARTNER_OFFERS: readonly PartnerOffer[] = [
  {
    id: 'intui-transfer',
    category: 'transfer',
    partner: 'Intui',
    description: 'Book an airport transfer in advance, so a driver is waiting when you land.',
    url: 'https://intui.tpk.lv/fpeuqQrG',
    when: ['before_trip', 'arrival'],
  },
  {
    id: 'airhelp-compensation',
    category: 'compensation',
    partner: 'AirHelp',
    description: 'Check whether a delayed or cancelled flight entitles you to compensation.',
    url: 'https://airhelp.tpk.lv/pGWVqGU3',
    when: ['after_flight'],
  },
  {
    id: 'yesim-esim',
    category: 'esim',
    partner: 'Yesim',
    description: 'A travel eSIM, so you have mobile data the moment you arrive.',
    url: 'https://yesim.tpk.lv/ecwWMBgq',
    when: ['before_trip', 'arrival'],
  },
  {
    id: 'gigsky-esim',
    category: 'esim',
    partner: 'GigSky',
    description: 'A travel eSIM, so you have mobile data the moment you arrive.',
    url: 'https://gigsky.tpk.lv/N27sJpgR',
    when: ['before_trip', 'arrival'],
  },
];

/** True when `url` is an `https` link on an allowed partner host (or a subdomain of one). */
export function isAllowedPartnerUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }

  if (parsed.protocol !== 'https:') return false;
  // Credentials in a link are how `https://tpk.lv@evil.example/` gets past a
  // glance; there is no reason for an affiliate link to carry any.
  if (parsed.username !== '' || parsed.password !== '') return false;

  // A dot before the host, so `evil-tpk.lv` is not `tpk.lv`.
  return ALLOWED_PARTNER_HOSTS.some(
    (host) => parsed.hostname === host || parsed.hostname.endsWith(`.${host}`),
  );
}

/** Every problem with a registry, in words. Empty when it is sound. */
export function registryProblems(offers: readonly PartnerOffer[]): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();

  for (const offer of offers) {
    if (seen.has(offer.id)) problems.push(`${offer.id}: duplicate id`);
    seen.add(offer.id);

    if (!isAllowedPartnerUrl(offer.url)) {
      problems.push(`${offer.id}: url is not https on an allowed partner host`);
    }
    if (offer.partner.trim() === '') problems.push(`${offer.id}: no partner name`);
    if (offer.description.trim() === '') problems.push(`${offer.id}: no description`);

    if (offer.promo) {
      if (offer.promo.code.trim() === '') problems.push(`${offer.id}: promo has no code`);
      if (offer.promo.expiresOn !== null && !isIsoDate(offer.promo.expiresOn)) {
        problems.push(`${offer.id}: promo expiry is not a calendar date`);
      }
    }
    if (offer.when?.length === 0) {
      problems.push(`${offer.id}: an empty "when" would never match; omit it instead`);
    }
  }

  return problems;
}

// At load, not on first use: a bad link in this file should stop the build's
// tests, not surface as one broken button in production.
const problems = registryProblems(PARTNER_OFFERS);
if (problems.length > 0) {
  throw new AppError('CONFIGURATION_ERROR', `Partner registry is invalid: ${problems.join('; ')}`);
}

/** Offers in a category, in registry order. Empty - never a placeholder - when there are none. */
export function offersFor(
  category: PartnerCategory,
  offers: readonly PartnerOffer[] = PARTNER_OFFERS,
): PartnerOffer[] {
  return offers.filter((offer) => offer.category === category);
}

export interface TripContext {
  /** The moments the surface is about. Omitted means every moment. */
  readonly moments?: readonly PartnerMoment[];
  /** Narrow to these categories. Omitted means every category. */
  readonly categories?: readonly PartnerCategory[];
}

/**
 * The offers relevant to a trip, in registry order.
 *
 * An offer with no `when` is relevant at every moment; one with a rule is
 * relevant when it shares a moment with the context. An empty `moments` list
 * is a context with no moments, and matches only offers with no rule.
 */
export function offersForTrip(
  context: TripContext = {},
  offers: readonly PartnerOffer[] = PARTNER_OFFERS,
): PartnerOffer[] {
  const { moments, categories } = context;

  return offers.filter((offer) => {
    if (categories && !categories.includes(offer.category)) return false;
    if (!moments || !offer.when) return true;
    return offer.when.some((moment) => moments.includes(moment));
  });
}

/**
 * The offer's promo, if it is still good on `today`.
 *
 * The expiry day itself still counts: "valid until 2026-12-31" means that
 * evening too. An expired code is not returned at all, rather than returned
 * with a flag, so no caller can forget to check it and show a dead code.
 */
export function activePromo(offer: PartnerOffer, today: IsoDate): PartnerPromo | null {
  const { promo } = offer;
  if (!promo) return null;
  if (promo.expiresOn === null) return promo;
  // A date we cannot read cannot prove the code is live, and a string compare
  // against garbage would call it live.
  if (!isIsoDate(today)) return null;

  return isAfter(today, promo.expiresOn) ? null : promo;
}
