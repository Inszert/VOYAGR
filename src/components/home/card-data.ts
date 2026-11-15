import type { RailCard } from '@/components/discovery/destination-rail';
import type { DestinationImage } from '@/providers/imagery/types';
import { imageryUrlFor } from '@/providers/imagery/url';
import { findCountryByIso2 } from '@/discovery/countries';
import type { DestinationPoint } from '@/discovery/map-model';

/**
 * What a home-page card is handed, already reduced to plain values.
 *
 * Built once from the discovery snapshot's cards so every surface below the
 * hero - mosaic, rail, the full-bleed moment, the credits - reads the same
 * object and cannot disagree about a place's picture or price. Nothing here is
 * computed: the label was formatted on the server from `Money`.
 */

export type CardImage =
  /** One of the generated set under `/img/destinations`. An illustration. */
  | { readonly kind: 'local'; readonly blur: string }
  /** Whatever the imagery provider found, through our own proxy. */
  | {
      readonly kind: 'remote';
      readonly src: string;
      readonly credit: DestinationImage['credit'];
    }
  | null;

export interface HomeCard {
  readonly code: string;
  readonly name: string;
  readonly country: string;
  /** "from EUR 401.00", as the server formatted it. */
  readonly label: string;
  readonly href: string;
  /** What the main link does, for its accessible name. */
  readonly actionLabel: string;
  readonly aboutHref: string;
  /** Why the card is where it is; read by assistive technology, not drawn. */
  readonly reason: string;
  readonly weather: { readonly maxC: number; readonly wet: boolean } | null;
  readonly bestScore: number | null;
  /**
   * One line about what is saved, or null. Nothing upstream produces one yet,
   * so nothing is drawn; the card is ready for the day core does.
   */
  readonly savings: string | null;
  readonly image: CardImage;
}

/**
 * A country's full name, never its two-letter code.
 *
 * The catalogue falls back to the ISO code for a place Natural Earth has no
 * country for (Hong Kong is "HK"). A card must not print that, so it is read
 * out through the country index and then the platform's own region names.
 * Anything that is not a bare code is returned as it came.
 */
export function fullCountryName(country: string): string {
  if (!/^[A-Za-z]{2}$/.test(country)) return country;

  const code = country.toUpperCase();

  try {
    return (
      findCountryByIso2(code)?.name ??
      new Intl.DisplayNames(['en'], { type: 'region' }).of(code) ??
      country
    );
  } catch {
    return country;
  }
}

export function toHomeCard(
  card: RailCard,
  localImages: Readonly<Record<string, { blur: string }>>,
): HomeCard {
  const point: DestinationPoint = card.point;
  const local = localImages[point.destination];

  return {
    code: point.destination,
    name: point.name,
    country: fullCountryName(point.country),
    label: card.label,
    href: card.href,
    actionLabel: card.actionLabel,
    aboutHref: card.aboutHref,
    reason: point.reason,
    weather: point.weather
      ? { maxC: point.weather.maxC, wet: point.weather.rainChance >= 0.4 }
      : null,
    bestScore: point.bestScore,
    savings: null,
    image: local
      ? { kind: 'local', blur: local.blur }
      : card.image
        ? { kind: 'remote', src: imageryUrlFor(point.destination), credit: card.image.credit }
        : null,
  };
}

/**
 * The place for the full-bleed moment, and whether it is the engine's best.
 *
 * The destination the engine ranked first when it has a picture; a full-bleed
 * section with no picture is an empty rectangle, so otherwise the best-scored
 * place that does have one, which the section then does not call "best". With
 * no picture anywhere it is still the engine's pick, drawn as its plain tile.
 */
export function pickMoment(
  cards: readonly HomeCard[],
  bestCode: string | null,
): { card: HomeCard; isBest: boolean } | null {
  const best = cards.find((card) => card.code === bestCode) ?? null;
  if (best && best.image) return { card: best, isBest: true };

  const pictured = cards
    .filter((card) => card.image && card.bestScore !== null)
    .sort((a, b) => (b.bestScore ?? 0) - (a.bestScore ?? 0))[0];
  if (pictured) return { card: pictured, isBest: false };

  return best ? { card: best, isBest: true } : null;
}
