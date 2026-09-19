'use client';

import * as React from 'react';
// The library itself is imported lazily below; its stylesheet is not, so the
// popup is styled the moment the map can draw one rather than a frame later.
import 'maplibre-gl/dist/maplibre-gl.css';
import type { DestinationPoint, MapMode } from '@/discovery/map-model';
import { toGeoJson } from '@/discovery/map-model';

/**
 * The discovery globe (1.10.1 sections 11 and 12).
 *
 * Section 28 sets the scope: this does not need production intelligence yet,
 * but it must already have the architecture so it is not bolted on later. So
 * the pieces that are expensive to retrofit are here and real - a globe
 * projection, a clustered source, zoom-tiered visibility, hover and click -
 * while the intelligence they will eventually carry lives in `map-model.ts`
 * and arrives without touching this file.
 *
 * Three decisions worth stating.
 *
 * **It is decoration, and the list beside it is the content.** A canvas cannot
 * be read by a screen reader, cannot be tabbed through and does not exist
 * before JavaScript. Every destination on it is also a link in the list, in
 * the same order, with the same figures and the same reason. The map is
 * `aria-hidden` and the product works without it - which is the only honest
 * way to ship a canvas as a signature feature.
 *
 * **Nothing is fetched from anybody.** The land comes from a Natural Earth
 * outline committed to this repository, public domain, and the destinations
 * are inlined. There is no tile server, no API key and no third party in the
 * render path. See `docs/map-options.md` for what adopting one would cost.
 *
 * **No text is drawn on the map.** Labels in a MapLibre style need a glyph
 * server, which is the external dependency this deliberately does not have.
 * Names and prices are in the popup and in the list, both ordinary DOM.
 */

export interface DestinationGlobeProps {
  points: readonly DestinationPoint[];
  mode: MapMode;
  /** Formatted price per destination code, so this never formats money itself. */
  labels: Readonly<Record<string, string>>;
}

/** A destination name is data, and data does not become markup. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** How long the map has to draw something before it is treated as broken. */
const LOAD_TIMEOUT_MS = 8_000;

/** Where the map opens. Europe and the Mediterranean, which is what we cover. */
const INITIAL_VIEW = { centre: [14, 34] as [number, number], zoom: 1.7 };

export function DestinationGlobe({ points, mode, labels }: DestinationGlobeProps) {
  const container = React.useRef<HTMLDivElement>(null);
  const [failed, setFailed] = React.useState(false);

  React.useEffect(() => {
    const element = container.current;
    if (!element) return;

    let map: { remove: () => void } | null = null;
    let cancelled = false;

    void (async () => {
      try {
        // Imported here rather than at module scope: it is a large library
        // that only the browser needs, and the page must render without it.
        const maplibre = await import('maplibre-gl');
        if (cancelled) return;

        /*
         * Point MapLibre at its own worker, served from our origin.
         *
         * Left alone it resolves the worker relative to `import.meta.url`,
         * which after bundling is a hashed Next chunk - so it asks for a file
         * that is not there, and then renders a background, reports no error
         * and never loads a single source. `scripts/copy-map-worker.mjs` puts
         * the worker under `/maplibre/` on every build; this is the other half
         * of that arrangement.
         */
        maplibre.setWorkerUrl('/maplibre/maplibre-gl-worker.mjs');

        const created = new maplibre.Map({
          container: element,
          center: INITIAL_VIEW.centre,
          zoom: INITIAL_VIEW.zoom,
          /*
           * Not compact, because compact adds a toggle button - and a button
           * inside an `aria-hidden` container is focusable content that
           * cannot be read, which axe flags and a keyboard user would feel as
           * a tab stop that announces nothing.
           */
          attributionControl: { compact: false, customAttribution: 'Made with Natural Earth' },
          style: {
            version: 8,
            // A globe rather than a flat rectangle, which is what section 11
            // asks for and what makes "where can I go" a question about a
            // world rather than about a list.
            projection: { type: 'globe' },
            // No glyphs and no sprite on purpose: both are URLs to somebody
            // else's server, and neither is needed without map text.
            sources: {
              world: { type: 'geojson', data: '/geo/world-countries-110m.json' },
              destinations: {
                type: 'geojson',
                data: toGeoJson(points, mode),
                /*
                 * Declared now, with eight points that will never trigger it.
                 *
                 * Section 12 is explicit that thousands of markers must not
                 * appear at once. Clustering is a property of the source, so
                 * turning it on later would mean rebuilding the layers that
                 * read it - which is exactly the "bolted on afterwards" that
                 * section 28 says to avoid.
                 */
                cluster: true,
                clusterRadius: 44,
                clusterMaxZoom: 4,
              },
            },
            layers: [
              { id: 'sea', type: 'background', paint: { 'background-color': '#12304b' } },
              {
                id: 'land',
                type: 'fill',
                source: 'world',
                paint: { 'fill-color': '#e8eef4' },
              },
              {
                id: 'borders',
                type: 'line',
                source: 'world',
                paint: { 'line-color': '#b6c6d6', 'line-width': 0.6 },
              },
              {
                id: 'clusters',
                type: 'circle',
                source: 'destinations',
                filter: ['has', 'point_count'],
                /*
                 * Deliberately not the same shape as a single destination.
                 *
                 * A cluster drawn identically to one place is a lie about how
                 * many there are, and map text is not available here to put a
                 * count on it. So it grows with what it holds and wears a
                 * heavier ring - and the list beside the map is where the
                 * actual number, and the actual names, are.
                 */
                paint: {
                  'circle-radius': ['step', ['get', 'point_count'], 13, 3, 17, 6, 21],
                  'circle-color': '#f5b642',
                  'circle-opacity': 0.9,
                  'circle-stroke-width': 4,
                  'circle-stroke-color': '#ffffff',
                  'circle-stroke-opacity': 0.55,
                },
              },
              {
                id: 'destination-points',
                type: 'circle',
                source: 'destinations',
                filter: ['!', ['has', 'point_count']],
                // Section 12's progressive disclosure: each point carries the
                // zoom its tier appears at, so smaller places can be added to
                // the data without a layer change.
                paint: {
                  'circle-radius': ['interpolate', ['linear'], ['zoom'], 2, 5, 7, 11],
                  'circle-color': [
                    'interpolate',
                    ['linear'],
                    ['get', 'rank'],
                    0,
                    '#f5b642',
                    5,
                    '#7aa7cc',
                  ],
                  'circle-stroke-width': 2,
                  'circle-stroke-color': '#ffffff',
                },
              },
            ],
          },
        });

        /*
         * Hover and click, section 12.
         *
         * A DOM popup rather than a symbol layer, because map text needs a
         * glyph server and that is the external dependency this deliberately
         * does not have. It also means the popup is ordinary markup the
         * browser can select and the page can style.
         */
        const popup = new maplibre.Popup({ closeButton: false, closeOnClick: false });

        created.on('mouseenter', 'destination-points', (event) => {
          const feature = event.features?.[0];
          if (!feature || feature.geometry.type !== 'Point') return;

          created.getCanvas().style.cursor = 'pointer';

          const properties = feature.properties as {
            destination: string;
            name: string;
            reason: string;
          };
          const price = labels[properties.destination];

          popup
            .setLngLat(feature.geometry.coordinates as [number, number])
            .setHTML(
              // Escaped, because a destination name is data. It comes from our
              // own catalogue today and from a provider tomorrow, and a name
              // with a bracket in it must not become markup.
              `<strong>${escapeHtml(properties.name)}</strong>` +
                (price ? `<br>${escapeHtml(price)}` : '') +
                `<br>${escapeHtml(properties.reason)}`,
            )
            .addTo(created);
        });

        created.on('mouseleave', 'destination-points', () => {
          created.getCanvas().style.cursor = '';
          popup.remove();
        });

        created.on('click', 'destination-points', (event) => {
          const feature = event.features?.[0];
          if (!feature) return;

          // The list is the content, so a click on the map moves to the list
          // entry rather than doing something the map alone can do. Keyboard
          // users reach the same place by tabbing, which is the point.
          const properties = feature.properties as { destination: string };
          document.getElementById(`destination-${properties.destination}`)?.focus();
        });

        // Clicking a cluster opens it, which is the only thing a cluster can
        // usefully mean.
        created.on('click', 'clusters', (event) => {
          const feature = event.features?.[0];
          if (!feature || feature.geometry.type !== 'Point') return;

          created.easeTo({
            center: feature.geometry.coordinates as [number, number],
            zoom: created.getZoom() + 2,
          });
        });

        /*
         * Out of the tab order.
         *
         * MapLibre gives its canvas `tabindex="0"` so the map can be panned
         * with the keyboard. Here the map is decoration inside an
         * `aria-hidden` container, and focusable content that cannot be read
         * is worse than no keyboard access: it is a tab stop that announces
         * nothing and does nothing a person can perceive. The list beside the
         * map is the keyboard path, and it goes to the same places.
         */
        created.getCanvas().setAttribute('tabindex', '-1');

        /*
         * Hide the map if it never actually loads.
         *
         * This guards a failure mode that cost real time to find: when
         * MapLibre cannot reach its worker it renders the background, reports
         * no error at all, and simply never loads a source - leaving a
         * convincing empty ocean where the world should be. An empty ocean is
         * worse than no map, because it looks like an answer.
         */
        const blankGuard = window.setTimeout(() => {
          if (!cancelled && !created.isStyleLoaded()) setFailed(true);
        }, LOAD_TIMEOUT_MS);

        created.once('load', () => window.clearTimeout(blankGuard));

        map = created;
      } catch {
        // A globe that fails to load must not take the page with it. The list
        // beside it already carries every destination, so this is a missing
        // decoration rather than a missing answer.
        if (!cancelled) setFailed(true);
      }
    })();

    return () => {
      cancelled = true;
      map?.remove();
    };
  }, [points, mode, labels]);

  if (failed) return null;

  return (
    <div
      ref={container}
      aria-hidden="true"
      className="bg-surface-sunken h-[22rem] w-full overflow-hidden rounded-[--radius-surface] sm:h-[28rem]"
    />
  );
}
