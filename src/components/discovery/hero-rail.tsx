'use client';

import * as React from 'react';
import { Icon, ProvenanceBreakdown } from '@/components/ui';
import type { DataProvenance, SourceAttribution } from '@/core/trip/provenance';
import { GLOBE_FOCUS_EVENT, GLOBE_RELEASE_EVENT } from './globe-motion';

/**
 * The right-edge rail: up to five live destinations, each tied to its pin.
 *
 * Every row is a real link to the same search its pin leads to, with the same
 * figure the server formatted - nothing here is computed. The rail only adds a
 * conversation with the globe: focusing a row (or resting a pointer on it)
 * flies the camera to its pin and lifts the pin; reaching a pin lights its row.
 * Without JavaScript it is still five links.
 *
 * The weather glyph is never alone: the figure and a word sit beside it.
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
   * blur placeholder, or any other image URL. Null: a wash from the code.
   */
  readonly image:
    | { readonly kind: 'local'; readonly blur: string }
    | { readonly kind: 'remote'; readonly src: string }
    | null;
}

export interface HeroRailProps {
  items: readonly HeroRailItem[];
  provenance: DataProvenance;
  sources?: readonly SourceAttribution[];
}

function washFor(code: string): React.CSSProperties {
  const hue = [...code].reduce((total, character) => total + character.charCodeAt(0), 0) % 360;

  return {
    backgroundImage: `linear-gradient(140deg, oklch(0.55 0.14 ${hue}) 0%, oklch(0.3 0.1 ${(hue + 40) % 360}) 100%)`,
  };
}

function Thumb({ item }: { item: HeroRailItem }) {
  const { image, code } = item;

  return (
    <span
      aria-hidden="true"
      className="relative block size-12 shrink-0 overflow-hidden rounded-[10px]"
      style={
        image?.kind === 'local'
          ? { backgroundImage: `url(${image.blur})`, backgroundSize: 'cover' }
          : washFor(code)
      }
    >
      {image?.kind === 'local' ? (
        <picture>
          <source
            type="image/avif"
            srcSet={`/img/destinations/${code}-480.avif 480w, /img/destinations/${code}-768.avif 768w`}
            sizes="48px"
          />
          <img
            src={`/img/destinations/${code}-480.webp`}
            srcSet={`/img/destinations/${code}-480.webp 480w, /img/destinations/${code}-768.webp 768w`}
            sizes="48px"
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
      ) : null}
    </span>
  );
}

export function HeroRail({ items, provenance, sources = [] }: HeroRailProps) {
  const list = React.useRef<HTMLUListElement>(null);
  const dwell = React.useRef<number | null>(null);

  const point = React.useCallback((code: string) => {
    window.dispatchEvent(new CustomEvent(GLOBE_FOCUS_EVENT, { detail: { code } }));
    document
      .querySelector(`.voyagr-chip[data-destination="${CSS.escape(code)}"]`)
      ?.setAttribute('data-lift', 'true');
  }, []);

  const release = React.useCallback(() => {
    window.dispatchEvent(new CustomEvent(GLOBE_RELEASE_EVENT));
    for (const chip of document.querySelectorAll('.voyagr-chip[data-lift]')) {
      chip.removeAttribute('data-lift');
    }
  }, []);

  /*
   * A pin lights its row.
   *
   * Delegated on the document because the pins are markers MapLibre owns. The
   * row gets `data-active`, which the stylesheet below turns into the same
   * border a hovered row has.
   */
  React.useEffect(() => {
    const root = list.current;
    if (!root) return;

    const mark = (event: Event, on: boolean) => {
      const chip = (event.target as Element | null)?.closest?.('.voyagr-chip[data-destination]');
      const code = chip?.getAttribute('data-destination');
      if (!code) return;

      root
        .querySelector(`[data-rail-for="${CSS.escape(code)}"]`)
        ?.toggleAttribute('data-active', on);
    };

    const over = (event: Event) => mark(event, true);
    const out = (event: Event) => mark(event, false);

    document.addEventListener('mouseover', over);
    document.addEventListener('mouseout', out);
    document.addEventListener('focusin', over);
    document.addEventListener('focusout', out);

    return () => {
      document.removeEventListener('mouseover', over);
      document.removeEventListener('mouseout', out);
      document.removeEventListener('focusin', over);
      document.removeEventListener('focusout', out);
      if (dwell.current !== null) window.clearTimeout(dwell.current);
    };
  }, []);

  if (items.length === 0) return null;

  return (
    <nav aria-labelledby="hero-rail-heading" data-globe-overlay className="stage-scope w-[17.5rem]">
      <h2 id="hero-rail-heading" className="sr-only">
        Live destinations
      </h2>

      {/*
        Said once, above the list, rather than on every row: whose figures
        these are. A demo price is not a weaker price, it is not a price, and
        the words stay beside the numbers.
      */}
      <div className="mb-2 flex justify-end">
        <ProvenanceBreakdown
          compact
          sources={sources}
          provenance={provenance}
          className="flex flex-col gap-0.5"
          badgeClassName="voyagr-demo text-dim bg-white/5 backdrop-blur-sm"
        />
      </div>

      <ul ref={list} className="flex flex-col gap-2">
        {items.map((item) => (
          <li key={item.code}>
            <a
              href={item.href}
              data-rail-for={item.code}
              onFocus={() => point(item.code)}
              onBlur={release}
              onPointerEnter={(event) => {
                // Only a resting pointer flies the camera, not one passing over.
                if (event.pointerType !== 'mouse') return;
                dwell.current = window.setTimeout(() => point(item.code), 350);
              }}
              onPointerLeave={() => {
                if (dwell.current !== null) window.clearTimeout(dwell.current);
                release();
              }}
              className="voyagr-rail-row focus-visible:outline-stage-accent flex min-h-16 items-center gap-3 rounded-[14px] p-2"
            >
              <Thumb item={item} />

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
