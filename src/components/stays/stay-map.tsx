'use client';

import * as React from 'react';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { Map as MapLibreMap, Marker } from 'maplibre-gl';
import { Popover } from 'radix-ui';
import { OsmCredit, osmStyle } from '@/components/map/osm';
import { clusterPins } from './pin-clusters';
import type { StayRow } from './stay-rows';

/**
 * The selected city, flat, with its places to stay on it.
 *
 * **A street map, shared with the destination page.** The base is OpenStreetMap's
 * raster tiles via `@/components/map/osm`, with the licence's credit line always
 * on screen. Each hotel sits at its real coordinates.
 *
 * **Constrained to the city.** `maxBounds` is the listing box plus a margin and
 * the minimum zoom is the one that fits it, so the map cannot be dragged off to
 * somewhere the list says nothing about.
 *
 * **Every pin is a button.** Tab order is list order; focus or hover opens the
 * card (a Radix popover anchored to the pin) and Escape closes it; a click
 * selects the stay and scrolls the list to it. Pins that would overlap are
 * clustered in screen space into one button that zooms in. Under reduced
 * motion nothing flies: every camera change is a jump.
 */

export interface StayMapProps {
  readonly rows: readonly StayRow[];
  readonly centre: { readonly latitude: number; readonly longitude: number };
  readonly area: {
    readonly south: number;
    readonly west: number;
    readonly north: number;
    readonly east: number;
  };
  readonly city: string;
  readonly activeId: string | null;
  readonly highlightedId: string | null;
  readonly selectedId: string | null;
  readonly onActivate: (id: string | null) => void;
  readonly onSelect: (id: string) => void;
  /** The card's contents for one row. */
  /** The card's contents for one row; without it there is no popover (the phone sheet has its own card). */
  readonly renderCard?: (row: StayRow) => React.ReactNode;
  readonly className?: string;
}

/** Two pins closer than this on screen are one cluster. */
const CLUSTER_RADIUS = 34;

function reducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** What a pin says to somebody who cannot see the map. */
export function pinLabel(row: StayRow): string {
  const parts = [row.name];
  if (row.stars !== null) parts.push(`${row.stars} stars`);
  parts.push(row.distanceLabel);
  parts.push(row.priceLabel ?? 'no price yet, check price');
  return parts.join(', ');
}

/** The short figure a priced pin carries; an unpriced one is a dot. */
function pinText(row: StayRow): string {
  return row.priceLabel ? row.priceLabel.split(' total')[0]! : '';
}

export function StayMap({
  rows,
  centre,
  area,
  city,
  activeId,
  highlightedId,
  selectedId,
  onActivate,
  onSelect,
  renderCard,
  className,
}: StayMapProps) {
  const container = React.useRef<HTMLDivElement>(null);
  const mapRef = React.useRef<MapLibreMap | null>(null);
  const pins = React.useRef(new Map<string, { marker: Marker; element: HTMLButtonElement }>());
  const [status, setStatus] = React.useState<'loading' | 'ready' | 'failed'>('loading');
  const [anchor, setAnchor] = React.useState<HTMLElement | null>(null);
  const leaveTimer = React.useRef(0);

  // Handlers registered once read the latest callbacks.
  const latest = React.useRef({ onActivate, onSelect });
  React.useEffect(() => {
    latest.current = { onActivate, onSelect };
  });

  React.useEffect(() => {
    const element = container.current;
    if (!element) return;
    let cancelled = false;
    let map: MapLibreMap | null = null;
    const markers = pins.current;
    const clusterMarkers: Marker[] = [];

    void (async () => {
      try {
        const maplibre = await import('maplibre-gl');
        if (cancelled) return;
        maplibre.setWorkerUrl(`/maplibre/${maplibre.getVersion()}/maplibre-gl-worker.mjs`);

        const width = area.east - area.west;
        const height = area.north - area.south;
        /*
         * Opens on where the hotels are - the middle eighty per cent of them,
         * so one guest house at the edge of the box does not zoom the whole
         * city out - and always with the centre in view. The listing box is
         * only the outer limit.
         */
        const middle = (values: number[]) => {
          const sorted = [...values].sort((a, b) => a - b);
          const at = (q: number) =>
            sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]!;
          return [at(0.1), at(0.9)] as const;
        };
        const [west, east] = middle(rows.map((row) => row.longitude));
        const [south, north] = middle(rows.map((row) => row.latitude));
        const bounds: [[number, number], [number, number]] = rows.length
          ? [
              [Math.min(west, centre.longitude), Math.min(south, centre.latitude)],
              [Math.max(east, centre.longitude), Math.max(north, centre.latitude)],
            ]
          : [
              [area.west, area.south],
              [area.east, area.north],
            ];

        map = new maplibre.Map({
          container: element,
          bounds,
          fitBoundsOptions: { padding: 24 },
          maxBounds: [
            [area.west - width * 0.25, area.south - height * 0.25],
            [area.east + width * 0.25, area.north + height * 0.25],
          ],
          maxZoom: 17,
          dragRotate: false,
          pitchWithRotate: false,
          touchZoomRotate: true,
          attributionControl: false,
          style: osmStyle({
            sources: {
              centre: {
                type: 'geojson',
                data: {
                  type: 'Feature',
                  properties: {},
                  geometry: { type: 'Point', coordinates: [centre.longitude, centre.latitude] },
                },
              },
            },
            layers: [
              {
                id: 'centre-ring',
                type: 'circle',
                source: 'centre',
                paint: {
                  'circle-radius': 7,
                  'circle-color': '#ffffff',
                  'circle-stroke-color': '#000000',
                  'circle-stroke-width': 2,
                },
              },
            ],
          }),
        });

        // The canvas is decoration; the pins and the list are the content.
        map.getCanvas().setAttribute('aria-hidden', 'true');
        map.getCanvas().setAttribute('tabindex', '-1');

        map.addControl(new maplibre.NavigationControl({ showCompass: false }), 'top-right');

        map.once('load', () => {
          if (cancelled || !map) return;
          // Cannot zoom out of the city: the fitted zoom is the floor.
          map.setMinZoom(Math.max(0, map.getZoom() - 0.5));
          setStatus('ready');
        });
        map.on('error', () => {
          if (!map?.isStyleLoaded()) setStatus('failed');
        });

        // Pins in list order, so Tab walks them in the order the list reads.
        for (const row of rows) {
          const button = document.createElement('button');
          button.type = 'button';
          button.className = 'voyagr-stay-pin';
          button.dataset.id = row.id;
          button.dataset.priced = row.price ? 'true' : 'false';
          button.setAttribute('aria-label', pinLabel(row));
          const text = pinText(row);
          if (text) {
            const span = document.createElement('span');
            span.className = 'tabular-nums';
            span.textContent = text;
            button.append(span);
          }

          const show = () => {
            window.clearTimeout(leaveTimer.current);
            setAnchor(button);
            latest.current.onActivate(row.id);
          };
          const hide = () => {
            window.clearTimeout(leaveTimer.current);
            leaveTimer.current = window.setTimeout(() => latest.current.onActivate(null), 160);
          };
          button.addEventListener('pointerenter', show);
          button.addEventListener('focus', show);
          button.addEventListener('pointerleave', hide);
          button.addEventListener('blur', hide);
          button.addEventListener('click', () => latest.current.onSelect(row.id));

          const marker = new maplibre.Marker({ element: button, anchor: 'bottom' })
            .setLngLat([row.longitude, row.latitude])
            .addTo(map);
          markers.set(row.id, { marker, element: button });
        }

        // Clusters: recomputed when the view settles, never per frame.
        const recluster = () => {
          if (!map) return;
          for (const cluster of clusterMarkers.splice(0)) cluster.remove();

          // A priced stay is never folded into a cluster: its figure is the point.
          for (const row of rows) {
            const pin = markers.get(row.id);
            if (pin && row.price) pin.element.hidden = false;
          }
          const screen = rows
            .filter((row) => !row.price)
            .map((row) => {
              const point = map!.project([row.longitude, row.latitude]);
              return { id: row.id, x: point.x, y: point.y };
            });

          for (const cluster of clusterPins(screen, CLUSTER_RADIUS)) {
            const alone = cluster.members.length === 1;
            for (const id of cluster.members) {
              const pin = markers.get(id);
              if (pin) pin.element.hidden = !alone;
            }
            if (alone) continue;

            const first = rows.find((row) => row.id === cluster.members[0])!;
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'voyagr-stay-cluster';
            button.textContent = String(cluster.members.length);
            button.setAttribute(
              'aria-label',
              `${cluster.members.length} places to stay here. Zoom in to see them.`,
            );
            button.addEventListener('click', () => {
              const members = rows.filter((row) => cluster.members.includes(row.id));
              const lngs = members.map((row) => row.longitude);
              const lats = members.map((row) => row.latitude);
              map?.fitBounds(
                [
                  [Math.min(...lngs), Math.min(...lats)],
                  [Math.max(...lngs), Math.max(...lats)],
                ],
                { padding: 80, maxZoom: 17, duration: reducedMotion() ? 0 : 500 },
              );
            });
            clusterMarkers.push(
              new maplibre.Marker({ element: button })
                .setLngLat([first.longitude, first.latitude])
                .addTo(map),
            );
          }
        };

        map.on('load', recluster);
        map.on('moveend', recluster);
        // The card is anchored to a pin's box; once the map moves, it closes.
        map.on('movestart', () => latest.current.onActivate(null));

        mapRef.current = map;
      } catch {
        if (!cancelled) setStatus('failed');
      }
    })();

    return () => {
      cancelled = true;
      window.clearTimeout(leaveTimer.current);
      for (const { marker } of markers.values()) marker.remove();
      markers.clear();
      for (const cluster of clusterMarkers) cluster.remove();
      map?.remove();
      mapRef.current = null;
    };
    // The map is built once per set of rows; selection is applied below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows]);

  // Highlight, selection and the active pin, as attributes on the buttons.
  React.useEffect(() => {
    for (const [id, { element }] of pins.current) {
      element.toggleAttribute('data-highlighted', id === highlightedId || id === activeId);
      element.setAttribute('aria-pressed', id === selectedId ? 'true' : 'false');
    }
  }, [highlightedId, activeId, selectedId, status]);

  // A stay selected from the list is brought into view; a jump under reduced motion.
  React.useEffect(() => {
    const map = mapRef.current;
    const row = rows.find((candidate) => candidate.id === selectedId);
    if (!map || !row || status !== 'ready') return;
    const bounds = map.getBounds();
    if (bounds.contains([row.longitude, row.latitude])) return;
    map.easeTo({
      center: [row.longitude, row.latitude],
      duration: reducedMotion() ? 0 : 400,
    });
  }, [selectedId, rows, status]);

  const active = rows.find((row) => row.id === activeId) ?? null;
  const anchorRef = React.useMemo(() => ({ current: anchor }), [anchor]);

  return (
    <div className={className} data-stay-map>
      <div
        ref={container}
        className="voyagr-stay-map h-full w-full"
        role="region"
        aria-label={`Street map of places to stay in ${city}`}
      />
      <OsmCredit />

      {status === 'loading' ? (
        <div
          aria-hidden="true"
          className="bg-surface-sunken absolute inset-0 animate-pulse motion-reduce:animate-none"
        />
      ) : null}
      {status === 'failed' ? (
        <p role="status" className="text-ink-muted absolute inset-x-4 top-4 text-sm">
          The map did not load. Every place it would show is in the list.
        </p>
      ) : null}

      {renderCard ? (
        <Popover.Root
          open={Boolean(active && anchor)}
          onOpenChange={(open) => {
            if (!open) onActivate(null);
          }}
        >
          {anchor ? (
            <Popover.Anchor virtualRef={anchorRef as React.RefObject<HTMLElement>} />
          ) : null}
          <Popover.Portal>
            <Popover.Content
              side="top"
              align="center"
              sideOffset={10}
              collisionPadding={12}
              className="voyagr-popover voyagr-stay-card w-72 p-4"
              // The pin keeps focus: the card is a description, not a place to go.
              onOpenAutoFocus={(event) => event.preventDefault()}
              onCloseAutoFocus={(event) => event.preventDefault()}
              onPointerEnter={() => window.clearTimeout(leaveTimer.current)}
              onPointerLeave={() => onActivate(null)}
              onEscapeKeyDown={() => onActivate(null)}
              onInteractOutside={(event) => event.preventDefault()}
            >
              {active ? renderCard(active) : null}
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>
      ) : null}
    </div>
  );
}
