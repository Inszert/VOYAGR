import { Icon } from '@/components/ui';
import type { DataProvenance, SourceAttribution } from '@/core/trip/provenance';
import { initials } from './initials';

/**
 * Live destinations, as the first section under the hero: up to five rows,
 * each a real link to the same search its pin leads to, with the figure the
 * server formatted. Nothing here is computed.
 *
 * The weather glyph is never alone: the figure sits beside it, and a screen
 * reader gets the sentence.
 */

export interface HeroRailItem {
  readonly code: string;
  readonly name: string;
  readonly country: string;
  /** The price as the server formatted it; empty when there is none to show. */
  readonly label: string;
  readonly href: string;
  readonly actionLabel: string;
  readonly weather: { readonly maxC: number; readonly wet: boolean } | null;
  /**
   * A photograph: one of the generated set under `/img/destinations`, with its
   * blur placeholder, or any other image URL. Null: a plain tile with the
   * country's initials.
   */
  readonly image:
    | { readonly kind: 'local'; readonly blur: string }
    | { readonly kind: 'remote'; readonly src: string }
    | null;
}

/** A destination's picture, or a plain tile saying which country it is. */
export function HeroThumb({
  item,
  className = 'size-12 rounded-[10px]',
}: {
  item: HeroRailItem;
  className?: string;
}) {
  const { image, code } = item;

  return (
    <span
      aria-hidden="true"
      className={`relative block shrink-0 overflow-hidden ${className} ${image ? '' : 'bg-surface-sunken text-muted border-hairline grid place-items-center border'}`}
      style={
        image?.kind === 'local'
          ? { backgroundImage: `url(${image.blur})`, backgroundSize: 'cover' }
          : undefined
      }
    >
      {image?.kind === 'local' ? (
        <picture>
          <source
            type="image/avif"
            srcSet={`/img/destinations/${code}-480.avif 480w, /img/destinations/${code}-768.avif 768w`}
            sizes="96px"
          />
          <img
            src={`/img/destinations/${code}-480.webp`}
            srcSet={`/img/destinations/${code}-480.webp 480w, /img/destinations/${code}-768.webp 768w`}
            sizes="96px"
            alt=""
            loading="eager"
            decoding="async"
            className="absolute inset-0 size-full object-cover"
          />
        </picture>
      ) : image?.kind === 'remote' ? (
        // eslint-disable-next-line @next/next/no-img-element -- a remote thumbnail the imagery provider already sized
        <img
          src={image.src}
          alt=""
          loading="eager"
          decoding="async"
          className="absolute inset-0 size-full object-cover"
        />
      ) : (
        <span className="text-[13px] font-medium tracking-[0.08em]">{initials(item.country)}</span>
      )}
    </span>
  );
}

export interface HeroRailProps {
  items: readonly HeroRailItem[];
  /** Kept so callers need not change; no badge is drawn from it. */
  provenance?: DataProvenance;
  sources?: readonly SourceAttribution[];
}

export function HeroRail({ items }: HeroRailProps) {
  if (items.length === 0) return null;

  return (
    <nav aria-labelledby="hero-rail-heading" className="stage-scope">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 id="hero-rail-heading" className="font-display text-display-sm text-stage-ink">
          Live destinations
        </h2>
      </div>

      <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
        {items.map((item) => (
          <li key={item.code}>
            <a
              href={item.href}
              data-rail-for={item.code}
              className="voyagr-rail-row focus-visible:outline-stage-accent flex min-h-16 items-center gap-3 rounded-[14px] p-2"
            >
              <HeroThumb item={item} />

              <span className="min-w-0 flex-1">
                <span className="sr-only">{item.actionLabel} </span>
                <span className="font-display text-stage-ink block truncate text-[17px] leading-tight">
                  {item.name}
                </span>
                <span className="text-stage-ink-muted block truncate text-[12px]">
                  {item.country}
                </span>
                {item.label ? (
                  <span className="text-stage-ink mt-0.5 block text-[13px] font-medium tabular-nums">
                    {item.label}
                  </span>
                ) : null}
              </span>

              {item.weather ? (
                <span className="text-stage-ink-muted flex shrink-0 flex-col items-center gap-0.5 text-[11px]">
                  <Icon name={item.weather.wet ? 'rain' : 'sun'} size={1} className="size-[16px]" />
                  <span className="tabular-nums">{item.weather.maxC}°C</span>
                  <span className="sr-only">
                    {item.weather.wet ? 'warmest day, rain likely' : 'warmest day of the stay'}
                  </span>
                </span>
              ) : null}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
