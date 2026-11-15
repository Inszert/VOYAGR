import * as React from 'react';
import { Icon } from '@/components/ui';
import { cn } from '@/lib/cn';
import { initials } from '@/components/discovery/initials';
import type { HomeCard } from './card-data';
import type { MosaicSlot } from './mosaic';
import './home.css';

/**
 * A destination, as a picture with a price on it.
 *
 * The one card the home page uses everywhere - mosaic, rail, the closing
 * moment's neighbours - so a place looks the same wherever it turns up.
 *
 * **The whole card is one link.** It is an empty, stretched anchor laid over
 * the card, named in full with `aria-label` ("Show only trips to Antalya,
 * Turkey, from EUR 401.00"), rather than a wrapper around the picture, so the
 * picture can keep a real `alt` without that text being read into the link's
 * name as well. The one other control, "About", is a separate link above it:
 * two links cannot nest, and the place's own page has to stay reachable.
 *
 * **One chip, top-left, at most.** No provenance badges: honesty is carried by
 * "from" on the price and by the footer's sentence about prices.
 *
 * **Contrast over a photograph** is not a token pair, so the text sits on a
 * scrim that is the page colour at 88% in the lower half, and carries a soft
 * halo of the same colour. See `home.css`.
 */

export type CardVariant = 'lead' | 'tile' | 'wide' | 'rail' | 'tall';

export interface DestinationCardProps {
  card: HomeCard;
  variant?: CardVariant;
  /** Where the card sits in the desktop mosaic; read by `home.css`. */
  slot?: MosaicSlot;
  /** The one label, top-left: a rank such as "Best value". */
  chip?: string | null;
  /** Position in its group, for the scroll stagger (capped at six). */
  index?: number;
  /** Load now. For the few that are on the first screen of the page. */
  priority?: boolean;
  /** The `sizes` hint for this card's width at each breakpoint. */
  sizes: string;
  /** Let the picture drift as the card scrolls past. Mosaic only. */
  parallax?: boolean;
  /** The element's level; the section above decides it. */
  headingLevel?: 2 | 3 | 4;
  className?: string;
}

/** The text a picture is described by. A generated one says so. */
export function imageAlt(card: HomeCard): string {
  const place = `${card.name}, ${card.country}`;

  return card.image?.kind === 'local' ? `${place} — AI-generated illustration` : place;
}

/**
 * The picture, or a plain tile with the country's initials.
 *
 * Fills whatever positioned box it is put in. A destination with no picture
 * is a quiet tile that says which country it is - not a gradient pretending to
 * be an image that has not loaded yet.
 */
export function HomePicture({
  card,
  sizes,
  priority = false,
}: {
  card: HomeCard;
  sizes: string;
  priority?: boolean;
}) {
  const { image, code } = card;

  if (image?.kind === 'local') {
    const set = (ext: 'avif' | 'webp') =>
      [480, 768, 1024].map((w) => `/img/destinations/${code}-${w}.${ext} ${w}w`).join(', ');

    return (
      <picture>
        <source type="image/avif" srcSet={set('avif')} sizes={sizes} />
        <img
          src={`/img/destinations/${code}-768.webp`}
          srcSet={set('webp')}
          sizes={sizes}
          alt={imageAlt(card)}
          width={1024}
          height={688}
          loading={priority ? 'eager' : 'lazy'}
          decoding="async"
          className="home-card__img"
        />
      </picture>
    );
  }

  if (image?.kind === 'remote') {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- our own proxy route, already sized by the provider
      <img
        src={image.src}
        alt={imageAlt(card)}
        loading={priority ? 'eager' : 'lazy'}
        decoding="async"
        className="home-card__img"
      />
    );
  }

  return (
    <span
      aria-hidden="true"
      className="home-card__initials font-display text-ink-muted grid place-items-center"
    >
      {initials(card.country)}
    </span>
  );
}

/** "from" sits back; the figure is what the eye lands on. Never taken apart for its number. */
export function HomePrice({ label, className }: { label: string; className?: string }) {
  const prefix = 'from ';

  if (!label.startsWith(prefix)) {
    return <span className={cn('text-ink-muted text-sm', className)}>{label}</span>;
  }

  return (
    <span className={cn('inline-flex items-baseline gap-1.5 whitespace-nowrap', className)}>
      <span className="text-ink-muted text-[0.8125rem]">from</span>
      <span className="text-ink text-[1.25rem] leading-none font-semibold tabular-nums">
        {label.slice(prefix.length)}
      </span>
    </span>
  );
}

/** A glyph and a figure, with the sentence for anyone who cannot see the glyph. */
export function HomeWeather({
  weather,
  className,
}: {
  weather: HomeCard['weather'];
  className?: string;
}) {
  if (!weather) return null;

  return (
    <span className={cn('text-ink inline-flex shrink-0 items-center gap-1.5 text-sm', className)}>
      <Icon
        name={weather.wet ? 'rain' : 'sun'}
        size={1}
        className={cn('size-4', weather.wet ? 'text-(--color-biome-ink)' : 'text-accent-300')}
      />
      <span className="font-medium tabular-nums">{weather.maxC}&deg;C</span>
      <span className="sr-only">
        {weather.wet ? ' warmest day, rain likely' : ' warmest day of the stay'}
      </span>
    </span>
  );
}

export function DestinationCard({
  card,
  variant = 'tile',
  slot,
  chip = null,
  index = 0,
  priority = false,
  sizes,
  parallax = false,
  headingLevel = 3,
  className,
}: DestinationCardProps) {
  const Heading = `h${headingLevel}` as 'h3';
  const name = [
    `${card.actionLabel} ${card.name}, ${card.country}`,
    card.label,
    ...(chip ? [chip] : []),
  ].join(', ');

  return (
    <li
      id={`destination-${card.code}`}
      data-variant={variant}
      data-slot={slot}
      style={{ '--i': Math.min(index, 5) } as React.CSSProperties}
      className={cn('home-card home-rise', className)}
    >
      <div
        className="home-card__frame"
        style={
          card.image?.kind === 'local'
            ? { backgroundImage: `url(${card.image.blur})`, backgroundSize: 'cover' }
            : undefined
        }
      >
        <div className={parallax ? 'home-par' : 'home-fill'}>
          <HomePicture card={card} sizes={sizes} priority={priority} />
        </div>
        <div aria-hidden="true" className="home-card__scrim" />
      </div>

      {chip ? <span className="home-card__chip">{chip}</span> : null}

      <div className="home-card__body">
        <Heading className="font-display home-card__name text-ink">{card.name}</Heading>
        <p className="text-ink home-card__country">{card.country}</p>

        <div className="home-card__facts">
          <HomePrice label={card.label} />
          <HomeWeather weather={card.weather} />
          <Icon
            name="arrow-right"
            size={1}
            className="home-card__arrow text-ink ml-auto size-[18px] shrink-0"
          />
        </div>

        {card.savings ? (
          <p className="text-positive-ink mt-1.5 text-[0.8125rem] font-medium">{card.savings}</p>
        ) : null}

        {/* Section 14: a ranking explains itself. Read, not drawn. */}
        <span className="sr-only">{card.reason}</span>
      </div>

      <a href={card.href} aria-label={name} className="home-card__link" />

      <a href={card.aboutHref} className="home-card__about">
        <span aria-hidden="true" className="home-card__about-disc">
          <Icon name="arrow-right" size={1} className="size-4 -rotate-45" />
        </span>
        <span className="sr-only">About {card.name}</span>
      </a>
    </li>
  );
}
