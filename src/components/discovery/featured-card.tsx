'use client';

import * as React from 'react';
import { Icon } from '@/components/ui';
import { GLOBE_FOCUS_EVENT, GLOBE_RELEASE_EVENT } from './globe-motion';
import { HeroThumb, type HeroRailItem } from './hero-rail';

/**
 * One destination on the hero: a glass card bottom-right of the planet.
 *
 * The best-placed destination, as a link to the same search its pin leads to -
 * not an editorial pick, which would be a claim nobody computed. Focusing it
 * (or resting a pointer on it) flies the camera to its pin, tilts it, and
 * leaves only that route drawn; leaving it brings the globe back. Without
 * JavaScript, or with the globe not loaded, it is simply a link.
 */
export function FeaturedCard({ item, reason }: { item: HeroRailItem; reason: string }) {
  const dwell = React.useRef<number | null>(null);

  const point = () =>
    window.dispatchEvent(new CustomEvent(GLOBE_FOCUS_EVENT, { detail: { code: item.code } }));
  const release = () => {
    if (dwell.current !== null) window.clearTimeout(dwell.current);
    window.dispatchEvent(new CustomEvent(GLOBE_RELEASE_EVENT));
  };

  React.useEffect(
    () => () => {
      if (dwell.current !== null) window.clearTimeout(dwell.current);
    },
    [],
  );

  return (
    <a
      href={item.href}
      data-globe-overlay
      onFocus={point}
      onBlur={release}
      onPointerEnter={(event) => {
        // Only a resting mouse flies the camera, not one passing over.
        if (event.pointerType === 'mouse') dwell.current = window.setTimeout(point, 350);
      }}
      onPointerLeave={release}
      className="voyagr-panel ease-out-quart duration-settled focus-visible:outline-stage-accent group stage-scope flex items-center gap-3 overflow-hidden rounded-[14px] p-2.5 transition-[border-color] hover:border-(--color-stage-accent)"
    >
      <HeroThumb item={item} className="size-[56px] rounded-[10px]" />

      <span className="min-w-0 flex-1">
        <span className="text-stage-ink block text-[14px] font-semibold">
          <span className="sr-only">{item.actionLabel}</span> {item.name}, {item.country}
        </span>
        <span className="text-stage-ink-muted line-clamp-2 block text-[12px] leading-[1.35]">
          {reason}
        </span>
        {item.label ? (
          <span className="text-stage-ink mt-1 block text-[12px] font-medium tabular-nums">
            {item.label}
          </span>
        ) : null}
      </span>

      <span
        aria-hidden="true"
        className="text-stage-ink-muted ease-standard duration-quick mr-1 shrink-0 transition-colors group-hover:text-(--color-stage-accent)"
      >
        <Icon name="arrow-right" size={1} className="size-[16px]" />
      </span>
    </a>
  );
}
