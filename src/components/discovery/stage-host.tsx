'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { GlobeStage } from './globe-stage';
import {
  getServerStageSnapshot,
  getStageSnapshot,
  setStagePending,
  subscribeStage,
  type StageVariant,
} from './stage-store';

/**
 * The one globe, for the whole visit to the front page and the explorer.
 *
 * Mounted by `src/app/(stage)/layout.tsx`, so it is not part of either page
 * and a navigation between them does not touch it: the MapLibre instance, its
 * canvas, its sources and its tiles survive, and new data is applied in place.
 * What a page contributes is a *slot* (where the globe should be) and *data*
 * (what it should show) - see `stage-slot.tsx` and `stage-sync.tsx`.
 *
 * Three jobs live here and nothing else:
 *
 *  - Sit exactly over the current slot, and when the slot changes between the
 *    hero and the explorer column, FLIP the globe's own box from where it was
 *    to where it is now (420ms) rather than jumping.
 *  - Turn the two kinds of navigation the pages use - a plain link and a plain
 *    GET form - into client-side ones. Both used to be full document loads,
 *    which is what rebuilt the globe on every search.
 *  - Say that a navigation is pending: the pins dim and a 2px line runs along
 *    the top of the stage until the next page's data arrives.
 */

/** `--ease-out-expo`, for the one animation that has to be written in script. */
const EASE_OUT_EXPO = 'cubic-bezier(0.16, 1, 0.3, 1)';
const FLIP_MS = 420;
/** A navigation that has not landed by now has failed or been abandoned. */
const PENDING_GIVE_UP_MS = 20_000;

/**
 * How the globe's root lays itself out in each composition.
 *
 * These are the classes the front page's hero and the explorer's column used
 * to put on their own copy of the globe. The hero's depend on `--hero-top`,
 * which `HeroMetrics` writes on the root element.
 */
const ROOT_CLASS: Record<StageVariant, string> = {
  stage:
    'absolute inset-x-0 top-[calc(38svh-var(--hero-top,0px))] z-0 h-[118vw] sm:top-[calc(var(--hero-top,0px)+72px)] sm:bottom-0 sm:h-auto lg:top-[8%] lg:bottom-auto lg:h-full',
  explorer: 'absolute inset-0',
};

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

function documentBox(element: Element): Box {
  const rect = element.getBoundingClientRect();
  return {
    x: rect.left + window.scrollX,
    y: rect.top + window.scrollY,
    w: rect.width,
    h: rect.height,
  };
}

function isStageUrl(url: URL): boolean {
  return (
    url.origin === window.location.origin && (url.pathname === '/' || url.pathname === '/explore')
  );
}

export function StageHost() {
  const snapshot = React.useSyncExternalStore(
    subscribeStage,
    getStageSnapshot,
    getServerStageSnapshot,
  );
  const router = useRouter();
  const hostRef = React.useRef<HTMLDivElement>(null);
  /** The globe's own box as last laid out, in document coordinates, for the FLIP. */
  const lastBox = React.useRef<Box | null>(null);
  const lastSlot = React.useRef<HTMLElement | null>(null);
  const flipping = React.useRef<Animation | null>(null);

  const { slot, variant, data, pending } = snapshot;

  /* ---- Over the slot, and the FLIP between slots. ---- */
  React.useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host || !slot) return;

    const container = host.offsetParent as HTMLElement | null;
    if (!container) return;

    const root = () => host.querySelector<HTMLElement>('.voyagr-stage');

    const place = () => {
      const c = container.getBoundingClientRect();
      const r = slot.getBoundingClientRect();
      const next = {
        left: `${Math.round(r.left - c.left)}px`,
        top: `${Math.round(r.top - c.top)}px`,
        width: `${Math.round(r.width)}px`,
        height: `${Math.round(r.height)}px`,
      };
      for (const [key, value] of Object.entries(next)) {
        if (host.style[key as 'left'] !== value) host.style[key as 'left'] = value;
      }
    };

    // First: where the globe was. Cancelled first, so a running animation's
    // transform is not measured as if it were layout.
    flipping.current?.cancel();
    flipping.current = null;

    place();

    const globe = root();
    const moved = lastSlot.current !== null && lastSlot.current !== slot;

    if (globe && moved && lastBox.current) {
      const before = lastBox.current;
      const after = documentBox(globe);
      const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

      if (
        !reduced &&
        after.w > 0 &&
        after.h > 0 &&
        (Math.abs(before.x - after.x) > 1 ||
          Math.abs(before.y - after.y) > 1 ||
          Math.abs(before.w - after.w) > 1 ||
          Math.abs(before.h - after.h) > 1)
      ) {
        /*
         * Inverted, then played. Uniform scale about the centre, so the
         * planet is never squashed on the way: the smaller of the two ratios,
         * with the centres brought together.
         */
        const scale = Math.min(before.w / after.w, before.h / after.h);
        const dx = before.x + before.w / 2 - (after.x + after.w / 2);
        const dy = before.y + before.h / 2 - (after.y + after.h / 2);

        flipping.current = globe.animate(
          [
            { transform: `translate(${dx}px, ${dy}px) scale(${scale})` },
            { transform: 'translate(0, 0) scale(1)' },
          ],
          { duration: FLIP_MS, easing: EASE_OUT_EXPO },
        );
      }
    }

    lastSlot.current = slot;
    if (globe) lastBox.current = documentBox(globe);

    // The box follows the slot while it is resized, and the page above it
    // growing; the globe's own box is re-recorded for the next FLIP.
    let frame = 0;
    const follow = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        place();
        const current = root();
        if (current && !flipping.current) lastBox.current = documentBox(current);
      });
    };

    const observer = new ResizeObserver(follow);
    observer.observe(slot);
    observer.observe(container);
    window.addEventListener('resize', follow);

    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener('resize', follow);
    };
  }, [slot, variant, data]);

  /* ---- Plain links and plain GET forms become client-side navigations. ---- */
  React.useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
        return;
      }

      const anchor = (event.target as Element | null)?.closest?.('a[href]');
      if (!(anchor instanceof HTMLAnchorElement)) return;
      if ((anchor.target && anchor.target !== '_self') || anchor.hasAttribute('download')) return;

      const url = new URL(anchor.href, window.location.href);
      if (!isStageUrl(url)) return;

      const here = window.location;
      const samePage = url.pathname === here.pathname && url.search === here.search;

      // A `Link` has already handled its own click; only note that it is under way.
      if (event.defaultPrevented) {
        if (!samePage) setStagePending(true);
        return;
      }

      // A hash on this very page is the browser's to scroll to.
      if (samePage && url.hash) return;

      event.preventDefault();
      if (!samePage) setStagePending(true);
      router.push(`${url.pathname}${url.search}${url.hash}` as never);
    };

    const onSubmit = (event: SubmitEvent) => {
      if (event.defaultPrevented) return;

      const form = event.target;
      if (!(form instanceof HTMLFormElement)) return;
      if ((form.getAttribute('method') ?? 'get').toLowerCase() !== 'get') return;
      if (form.target && form.target !== '_self') return;

      let action: URL;
      try {
        action = new URL(form.action, window.location.href);
      } catch {
        return;
      }
      if (!isStageUrl(action)) return;

      const params = new URLSearchParams();
      for (const [key, value] of new FormData(form, event.submitter)) {
        if (typeof value === 'string') params.append(key, value);
      }

      event.preventDefault();
      setStagePending(true);
      const query = params.toString();
      router.push(`${action.pathname}${query ? `?${query}` : ''}` as never);
    };

    document.addEventListener('click', onClick);
    document.addEventListener('submit', onSubmit);
    return () => {
      document.removeEventListener('click', onClick);
      document.removeEventListener('submit', onSubmit);
    };
  }, [router]);

  /* ---- A pending state that cannot stick. ---- */
  React.useEffect(() => {
    if (!pending) return;
    const timer = window.setTimeout(() => setStagePending(false), PENDING_GIVE_UP_MS);
    return () => window.clearTimeout(timer);
  }, [pending]);

  return (
    <div
      ref={hostRef}
      data-stage-host
      data-variant={variant}
      data-pending={pending ? 'true' : 'false'}
      className={
        // The hero crops the planet from 1024px up; below that it bleeds
        // downwards and is clipped only at the sides.
        variant === 'stage'
          ? 'pointer-events-auto absolute z-0 [overflow-x:clip] lg:overflow-clip'
          : 'pointer-events-auto absolute z-0 [overflow-x:clip]'
      }
      style={{ left: 0, top: 0, width: 0, height: 0 }}
    >
      <div aria-hidden="true" data-active={pending} className="voyagr-stage-progress" />
      <p role="status" className="sr-only">
        {pending ? 'Updating the map' : ''}
      </p>

      {data ? <GlobeStage {...data} variant={variant} className={ROOT_CLASS[variant]} /> : null}
    </div>
  );
}
