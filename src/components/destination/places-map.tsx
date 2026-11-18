'use client';

import * as React from 'react';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { Map as MapLibreMap, Marker } from 'maplibre-gl';
import { formatKilometres } from '@/core/distance';
import type { ThingToDo } from '@/providers/types';

/**
 * The places, placed: a street map of the city with a dot per place.
 *
 * The base is OpenStreetMap's raster tiles (`TILE_URL`), the one third-party
 * host the page talks to for this; `src/consent/csp.ts` names it in `img-src`
 * and `connect-src` and nowhere else. Each dot sits at the place's real
 * coordinates and the view is fitted to them. The credit line is part of the
 * licence and is always on screen.
 *
 * The canvas and the dots are for the eye. The same facts are in the DOM twice
 * over: the cards beside the map, and a list of buttons here that names every
 * place and how far it is from the centre. A focused card rings its dot.
 *
 * Positions are for drawing only. A distance that is shown in words comes from
 * `src/core/distance`.
 */

const TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const DOT_MIN = 3.5;
const DOT_MAX = 7;
const MAX_FIT_ZOOM = 16;

/**
 * A dot's radius from its sitelink count (how many Wikipedia editions cover the
 * place), scaled across the places on the map. Drawing only: the count itself is
 * the source's, and equal counts - or one place - get the middle size.
 */
export function dotRadius(notability: number, lowest: number, highest: number): number {
  if (highest <= lowest) return (DOT_MIN + DOT_MAX) / 2;
  const share = (Math.min(Math.max(notability, lowest), highest) - lowest) / (highest - lowest);

  return DOT_MIN + (DOT_MAX - DOT_MIN) * share;
}

/** What a dot says to somebody who cannot see the map. */
export function dotLabel(place: ThingToDo): string {
  return `${place.name}, ${formatKilometres(place.distanceFromCentreMetres)} from centre`;
}

export interface PlacesMapProps {
  places: readonly ThingToDo[];
  /** `[longitude, latitude]` of the city's centre. */
  centre: readonly [number, number];
  /** The place a card is hovering or focusing: its dot is ringed. */
  activeId?: string | null;
  onActive?: (id: string | null) => void;
  onSelect?: (id: string) => void;
  /** The sheet's locator: this place is drawn large, the rest as faint dots. */
  focusId?: string | null;
  className?: string;
}

const DOT_BASE =
  'block rounded-full border-2 border-white bg-brand-ink shadow-[0_0_0_1px_rgb(0_0_0/0.55)] transition-[scale,opacity] duration-150 motion-reduce:transition-none';

export function PlacesMap({
  places,
  centre,
  activeId = null,
  onActive,
  onSelect,
  focusId = null,
  className,
}: PlacesMapProps) {
  const container = React.useRef<HTMLDivElement>(null);
  const dots = React.useRef(new Map<string, HTMLElement>());
  const [status, setStatus] = React.useState<'loading' | 'ready' | 'failed'>('loading');
  const legend = focusId === null;

  // Handlers registered once read the latest callbacks.
  const latest = React.useRef({ onActive, onSelect });
  React.useEffect(() => {
    latest.current = { onActive, onSelect };
  });

  React.useEffect(() => {
    const element = container.current;
    if (!element) return;
    let cancelled = false;
    let map: MapLibreMap | null = null;
    const markers: Marker[] = [];
    const byId = dots.current;

    void (async () => {
      try {
        const maplibre = await import('maplibre-gl');
        if (cancelled) return;
        maplibre.setWorkerUrl(`/maplibre/${maplibre.getVersion()}/maplibre-gl-worker.mjs`);

        const counts = places.map((place) => place.notability);
        const lowest = Math.min(...counts);
        const highest = Math.max(...counts);

        // The view: the one place for the sheet's locator, otherwise all of them and the centre.
        const focus = focusId ? places.find((place) => place.id === focusId) : undefined;
        const fitted = focus ? [focus] : places;
        const lons = [...fitted.map((place) => place.longitude), centre[0]];
        const lats = [...fitted.map((place) => place.latitude), centre[1]];
        const bounds: [[number, number], [number, number]] = [
          [Math.min(...lons), Math.min(...lats)],
          [Math.max(...lons), Math.max(...lats)],
        ];

        map = new maplibre.Map({
          container: element,
          bounds,
          fitBoundsOptions: { padding: 40, maxZoom: focus ? 15 : MAX_FIT_ZOOM },
          maxZoom: 18,
          dragRotate: false,
          pitchWithRotate: false,
          touchZoomRotate: true,
          cooperativeGestures: true,
          attributionControl: false,
          style: {
            version: 8,
            projection: { type: 'mercator' },
            sources: {
              osm: {
                type: 'raster',
                tiles: [TILE_URL],
                tileSize: 256,
                maxzoom: 19,
              },
            },
            layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
          },
        });

        // The canvas is decoration; the dots' list and the cards are the content.
        map.getCanvas().setAttribute('aria-hidden', 'true');
        map.getCanvas().setAttribute('tabindex', '-1');

        map.addControl(new maplibre.NavigationControl({ showCompass: false }), 'top-right');

        map.once('load', () => {
          if (!cancelled) setStatus('ready');
        });
        map.on('error', () => {
          if (!map?.isStyleLoaded()) setStatus('failed');
        });

        // The city centre, named by the legend and ringed on the map.
        const centreDot = document.createElement('span');
        centreDot.setAttribute('aria-hidden', 'true');
        centreDot.className =
          'block size-4 rounded-full border-2 border-black bg-white shadow-[0_0_0_2px_rgb(255_255_255/0.9)]';
        markers.push(new maplibre.Marker({ element: centreDot }).setLngLat([...centre]).addTo(map));

        for (const place of places) {
          const dot = document.createElement('span');
          // Decorative: the list below the map is the keyboard and screen-reader way in.
          dot.setAttribute('aria-hidden', 'true');
          dot.dataset.placeDot = place.id;
          const faint = focusId !== null && place.id !== focusId;
          const diameter =
            focusId !== null
              ? faint
                ? 10
                : 20
              : Math.round(dotRadius(place.notability, lowest, highest) * 2 + 8);
          dot.className = `${DOT_BASE} ${faint ? 'opacity-40' : ''} ${onSelect ? 'cursor-pointer' : ''}`;
          dot.style.width = `${diameter}px`;
          dot.style.height = `${diameter}px`;
          dot.addEventListener('pointerenter', () => latest.current.onActive?.(place.id));
          dot.addEventListener('pointerleave', () => latest.current.onActive?.(null));
          dot.addEventListener('click', () => latest.current.onSelect?.(place.id));

          markers.push(
            new maplibre.Marker({ element: dot })
              .setLngLat([place.longitude, place.latitude])
              .addTo(map),
          );
          byId.set(place.id, dot);
        }
      } catch {
        if (!cancelled) setStatus('failed');
      }
    })();

    return () => {
      cancelled = true;
      for (const marker of markers) marker.remove();
      byId.clear();
      map?.remove();
    };
    // The map is built once per set of places and focus; hover is applied below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [places, centre, focusId]);

  // The dot a card points at is ringed and lifted.
  React.useEffect(() => {
    for (const [id, dot] of dots.current) {
      const active = id === activeId || id === focusId;
      dot.toggleAttribute('data-active', active);
      dot.style.setProperty('scale', active ? '1.35' : '');
      dot.style.setProperty('outline', id === activeId && focusId === null ? '3px solid #fff' : '');
      dot.style.setProperty('z-index', active ? '2' : '');
    }
  }, [activeId, focusId, status]);

  return (
    <div className={className} data-places-map>
      <div className="relative">
        <div
          ref={container}
          className="voyagr-stay-map bg-surface-sunken h-72 w-full overflow-hidden rounded-[14px] sm:h-96"
          role="region"
          aria-label="Street map of the places"
        />
        {/* The licence's credit line, ours rather than the control's, so it is always on screen. */}
        <p className="absolute right-0 bottom-0 z-10 rounded-tl-lg rounded-br-[14px] bg-black/75 px-2 py-0.5 text-[11px] text-white">
          <a
            href="https://www.openstreetmap.org/copyright"
            target="_blank"
            rel="noopener noreferrer"
            className="underline underline-offset-2"
          >
            © OpenStreetMap contributors
          </a>
        </p>
        {status === 'failed' ? (
          <p
            role="status"
            className="text-ink-muted bg-surface-sunken absolute inset-x-0 top-0 rounded-[14px] p-4 text-sm"
          >
            The map did not load. Every place it would show is listed below the map.
          </p>
        ) : null}
      </div>

      {/* The accessible version of every dot: a name and a distance each. */}
      <ul aria-label="Places on the map" className="sr-only">
        {places.map((place) => (
          <li key={place.id}>
            <button
              type="button"
              onFocus={() => onActive?.(place.id)}
              onBlur={() => onActive?.(null)}
              onClick={() => onSelect?.(place.id)}
            >
              {dotLabel(place)}
            </button>
          </li>
        ))}
      </ul>

      {legend ? (
        <p className="text-ink-muted mt-3 text-sm" data-legend="">
          Each dot is a place, at its real position. Bigger means more Wikipedia languages cover it.
          The white ring is the city centre.
        </p>
      ) : null}
    </div>
  );
}
