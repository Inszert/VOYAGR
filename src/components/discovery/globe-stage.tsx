'use client';

import * as React from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
// The library itself is imported lazily below; its stylesheet is not, so the
// tooltip and chips are styled the moment the map can draw one.
import 'maplibre-gl/dist/maplibre-gl.css';
import type { GeoJSONSource, Map as MapLibreMap, MapLayerMouseEvent, Marker } from 'maplibre-gl';
import { cn } from '@/lib/cn';
import { Icon } from '@/components/ui';
import type { DataProvenance, SourceAttribution } from '@/core/trip/provenance';
import { bandFor, monthName, sunLatitude, type SurfaceKind } from '@/discovery/seasons';
import type { SkyCondition } from '@/discovery/sky-condition';
import {
  routeDashPattern,
  buildGlobeStyle,
  CITY_LIGHT_LAYERS,
  cityLightPaint,
  earthLayer,
  earthMonthOf,
  earthSource,
  earthTilesUrl,
  type GlobeColors,
} from './globe-style';
import {
  chooseLabels,
  DOT_INSET,
  labelBudget,
  LABEL_PLACES_URL,
  LIMB_EXIT_COSINE,
  parseLabelPlaces,
  placeLinkLabel,
  TIER_TWO_ZOOM,
  type LabelCandidate,
  type LabelPlace,
  type Rect,
} from './globe-labels';
import {
  DUSK_STEPS,
  DUSK_STEP_ALPHA,
  solarFactors,
  sunGeoJson,
  sunPosition,
  type SunPosition,
} from '@/discovery/terminator';
import { GLOBE_TEXTURES } from './globe-textures';
import { restingCentre } from './globe-camera';
import {
  facing,
  pointAt,
  projectArc,
  readSphere,
  sunOnSphere,
  toArcRuns,
  type ProjectedArc,
  type SphereFrame,
} from './globe-arcs';
import {
  ARC_DRAW_MS,
  EASE_OUT_EXPO,
  EASE_OUT_QUART_CSS,
  FLY_MS,
  FLY_PITCH,
  FLY_ZOOM,
  GLOBE_FOCUS_EVENT,
  GLOBE_RELEASE_EVENT,
  MAX_ARCS,
  RETURN_MS,
  SPIN_DEGREES_PER_SECOND,
  SPIN_RESUME_DELAY_MS,
  arcLightFraction,
  arcLightOpacity,
  ARC_FADE_MS,
  arcTargetOpacity,
  changedPins,
  heroDiameter,
  PHONE_MAX_WIDTH,
  STAGE_FRAME_EVENT,
  WIDE_MIN_WIDTH,
  spinFactor,
} from './globe-motion';

/** How long the camera takes to follow the globe's box between pages: inside 900-1400ms. */
const REFRAME_MS = 1100;

/** How long a pin that has left takes to fade out before its marker is removed. */
const PIN_LEAVE_MS = 220;

/** Where the last-seen prices are kept, to know which pin to pulse. */
const PIN_PRICES_KEY = 'voyagr.pin-prices';

/**
 * The globe (1.10.1 sections 11 and 12, second pass).
 *
 * This is the primary navigation surface of the product, and three things
 * about it are deliberate.
 *
 * **The canvas is decoration; the chips and the rail are content.** A canvas
 * cannot be read, tabbed through or rendered before JavaScript. So the
 * canvas is `aria-hidden` and out of the tab order, every price on it is a
 * real link in a `Marker` element, and the rail beside the globe lists the
 * same places in the same order with the same figures. Nothing is reachable
 * only by spinning.
 *
 * **It never decides anything.** Points, routes, labels, ranks and reasons
 * arrive as props, computed on the server from figures the engines produced.
 * The renderer draws; the only thing it originates is a navigation.
 *
 * **It reaches nobody.** Land comes from a Natural Earth file on our origin,
 * the worker from our origin, and there is no tile, glyph or sprite URL in
 * the style. That property is asserted by an end-to-end test.
 *
 * The map is created once and updated in place, so a selection is a fly-to
 * over a globe that is already there rather than a new globe. Selection
 * itself is a URL: clicking a country pushes `?country=`, the server narrows
 * the rail, and this component receives the selection back as a prop.
 */

export interface StageChip {
  readonly destination: string;
  readonly name: string;
  readonly country: string;
  readonly adm0: string | null;
  /** `[longitude, latitude]`. */
  readonly position: readonly [number, number];
  /**
   * The price, formatted on the server. Empty where there is no price to
   * show - a destination's own page knows the place but not what a trip
   * there costs, and a chip must not imply one.
   */
  readonly label: string;
  readonly reason: string;
  /** Where the chip goes. A search, or a filter over one. */
  readonly href: string;
  readonly actionLabel: string;
  readonly rank: number;
  /** True when the chip is inside the selected country, or is the selected destination. */
  readonly highlighted: boolean;
  /** What the sky does there on the searched dates. Absent or null: no outlook. */
  readonly condition?: SkyCondition | null;
}

export interface StageOrigin {
  readonly code: string;
  readonly name: string;
  readonly position: readonly [number, number];
}

/** GeoJSON as the server built it. Typed loosely: MapLibre reads it, we do not. */
export type StageGeoJson = {
  readonly type: 'FeatureCollection';
  readonly features: readonly unknown[];
};

export interface GlobeStageProps {
  chips: readonly StageChip[];
  origins: readonly StageOrigin[];
  routes: StageGeoJson;
  points: StageGeoJson;
  /**
   * The land, dissolved: continents and islands with no boundaries in them.
   * This is what the sphere draws.
   */
  landUrl: string;
  iceUrl: string;
  placesUrl: string;
  /**
   * The country outlines. Never drawn - this is how a click on the globe
   * resolves to a country, which a dissolved landmass cannot answer.
   */
  countriesUrl: string;
  /**
   * Finer coastlines, fetched only once the map is zoomed far enough for the
   * globe-scale outline to look like a cartoon. A megabyte nobody looking at
   * the whole world needs to download.
   */
  countriesDetailUrl: string;
  /** Mountain ranges, deserts and plateaus. Real geography, not a texture. */
  physicalUrl: string;
  cityLightsUrl: string;
  coastlineUrl: string;
  /**
   * The season, as bands of latitude, computed on the server from the dates
   * the page is about. A model of where the sun is, not an observation.
   */
  /**
   * The date the world is lit for, so the weather over it can match. The
   * component reads the same pure model the bands were built from rather
   * than being handed a second answer that could disagree with the first.
   */
  seasonDate: string;
  /**
   * The selected country's states and provinces, or null when nothing is
   * selected and when the catalogue has no regions for it.
   */
  regionsUrl: string | null;
  provenance: DataProvenance;
  /** Who supplied each part, so a chip can badge flights and hotels separately. */
  sources?: readonly SourceAttribution[];
  /** Priced destinations per country key, for the hover tooltip. */
  countryCounts: Readonly<Record<string, number>>;
  selectedCountry: {
    readonly adm0: string;
    readonly name: string;
    readonly bbox: readonly number[];
  } | null;
  /** The path and query a country selection is written into. */
  navigation: { readonly path: string; readonly query: string };
  /**
   * `hero` sits beside the headline; `explorer` fills a page; `stage` is the
   * front page's: a box the parent positions, with the planet sized to the
   * viewport rather than to the box (`heroDiameter`).
   */
  variant?: 'hero' | 'explorer' | 'stage';
  className?: string;
}

/**
 * Run something once the style can take it.
 *
 * Not `map.once('idle')`, which is the obvious answer and the wrong one here:
 * the globe animates - the snow glitters and the routes flow - so a map that
 * is working correctly never goes idle at all, and anything waiting for idle
 * waits for ever. This polls instead, briefly and with a bound, which is what
 * "wait for the style to settle" actually means.
 */
function whenStyleReady(map: MapLibreMap, run: () => void, attempt = 0): void {
  if (map.isStyleLoaded()) {
    run();
    return;
  }

  /*
   * Thirty seconds of trying, not ten.
   *
   * The bound exists so a style that never settles cannot leave a timer
   * running for ever. But giving up is not a graceful degradation here - what
   * waits on this is an open country's regions and the finer coastlines, and
   * abandoning them means they never appear at all, silently. Ten seconds was
   * comfortable on a developer's machine and not comfortable on a slow phone
   * that has just been handed a megabyte of coastline, which is exactly the
   * machine that needed the patience.
   */
  if (attempt > 240) return;

  window.setTimeout(() => whenStyleReady(map, run, attempt + 1), 125);
}

/** How long the map has to draw something before it is treated as broken. */
const LOAD_TIMEOUT_MS = 8_000;

/**
 * Room to leave round an opened country so all of it is in view.
 *
 * Even padding put the bottom of a country under the card the stage floats
 * over the globe, and the top under the controls, so the country looked cut
 * off though the camera had framed all of it. More room below than above,
 * scaled to the container so a short mobile globe does not ask for more
 * padding than it has pixels.
 */
function countryPadding(map: MapLibreMap): {
  top: number;
  right: number;
  bottom: number;
  left: number;
} {
  const container = map.getContainer();
  const frame = frameOf(container);
  /*
   * On the explorer the canvas runs past the slot, and the map's own padding
   * (`explorerPadding`) already centres the camera on it. MapLibre adds a
   * fit's padding to that, so this is measured against the slot alone: adding
   * the slot's insets here as well counted them twice, and a country could not
   * be fitted at all.
   */
  const width = frame?.width ?? container.clientWidth;
  const height = frame?.height ?? container.clientHeight;

  return {
    top: Math.round(Math.min(70, height * 0.1)),
    bottom: Math.round(Math.min(150, height * 0.24)),
    left: Math.round(Math.min(70, width * 0.08)),
    right: Math.round(Math.min(70, width * 0.08)),
  };
}

/**
 * How the camera flies to a selection: 1400ms on `--ease-out-expo`, tilting
 * to 18 degrees. A 0ms jump under `prefers-reduced-motion`; the view it lands
 * on is the same.
 */
function flightTo(map: MapLibreMap) {
  return {
    padding: countryPadding(map),
    maxZoom: 4.5,
    pitch: FLY_PITCH,
    duration: prefersReducedMotion() ? 0 : FLY_MS,
    easing: EASE_OUT_EXPO,
  };
}

/** The way back: 900ms on the same curve, level again. */
function returnTo(view: { center: [number, number]; zoom: number }) {
  return {
    ...view,
    pitch: 0,
    duration: prefersReducedMotion() ? 0 : RETURN_MS,
    easing: EASE_OUT_EXPO,
  };
}

/**
 * Where the planet sits in a wide hero: the centre of the right two thirds.
 *
 * The map's canvas is the whole hero - a box that stopped at the planet's
 * left edge cut the sphere off in a hard vertical line the moment it was
 * zoomed past the box - and the planet is moved right of centre by padding the
 * camera instead, so the view's centre is at 66% of the width.
 */
function stagePadding(width: number): { top: number; right: number; bottom: number; left: number } {
  return {
    top: 0,
    right: 0,
    bottom: 0,
    left: width >= WIDE_MIN_WIDTH ? Math.round(width * 0.36) : 0,
  };
}

/**
 * Where the page's box for the globe sits inside its canvas.
 *
 * On the explorer the canvas is the whole hero section so a zoomed planet is
 * never cut off square; the slot is the part the sphere rests in. Written by
 * the label pass's geometry refresh as `data-frame` on the map container:
 * top, right, bottom and left insets, then the slot's width and height.
 */
function frameOf(container: HTMLElement) {
  const values = container.dataset.frame?.split(',').map(Number);
  if (!values || values.length !== 6 || values.some((value) => !Number.isFinite(value))) {
    return null;
  }
  const [top, right, bottom, left, width, height] = values as [
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  return width > 0 && height > 0 ? { top, right, bottom, left, width, height } : null;
}

/** The camera padding that centres the sphere on the slot rather than the canvas. */
function explorerPadding(container: HTMLElement) {
  const frame = frameOf(container);
  if (!frame) return { top: 0, right: 0, bottom: 0, left: 0 };
  return {
    top: Math.max(0, frame.top),
    right: Math.max(0, frame.right),
    bottom: Math.max(0, frame.bottom),
    left: Math.max(0, frame.left),
  };
}

/** The painted sphere is measured at about 0.855 of the side `overview` is given. */
const STAGE_FIT = 1.22;

/** Where the world opens when there is nothing to fit to: Europe and the Mediterranean. */
const FALLBACK_VIEW = { center: [18, 38] as [number, number], zoom: 1.8 };

/** Every source carrying country outlines, in the order they were added. */
const WORLD_SOURCES = ['world', 'world-detail'] as const;

/**
 * The zoom at which the globe-scale coastline stops being good enough.
 *
 * Below it a 1:110m outline is the right resolution rather than a degraded
 * one; above it the angles start to show, and a megabyte is worth spending
 * on somebody who has zoomed in to look at a country.
 */
const DETAIL_ZOOM = 2.4;

/**
 * A stage token as a colour MapLibre accepts.
 *
 * The tokens are OKLCH custom properties, and MapLibre's colour parser does
 * not read OKLCH. The browser's canvas does, and reads back a hex string, so
 * the conversion happens in the one place that already knows the colour
 * space. Falls back to the hex beside each token if that fails, which it does
 * in a test environment without a canvas.
 */
function resolveColor(token: string, fallback: string): string {
  if (typeof document === 'undefined') return fallback;

  const raw = getComputedStyle(document.documentElement).getPropertyValue(token).trim();
  if (!raw) return fallback;

  const context = document.createElement('canvas').getContext('2d');
  if (!context) return fallback;

  context.fillStyle = '#000';
  context.fillStyle = raw;
  const resolved = String(context.fillStyle);

  return resolved.startsWith('#') || resolved.startsWith('rgb') ? resolved : fallback;
}

/**
 * How far through the UTC day it is, in minutes.
 *
 * The one clock reading the globe makes. The season comes from a date the
 * server chose; only the planet's rotation comes from now, which is why this
 * is a function called at render rather than a value passed in - a server and
 * a browser reading it would disagree by however long the page took to
 * arrive, and the sun would jump on hydration.
 */
function minutesIntoUtcDay(): number {
  const now = new Date();
  return now.getUTCHours() * 60 + now.getUTCMinutes() + now.getUTCSeconds() / 60;
}

function stageColors(): GlobeColors {
  return {
    space: resolveColor('--color-stage-deep', '#080a16'),
    sea: resolveColor('--color-stage-sea', '#12395e'),
    seaDeep: resolveColor('--color-stage-sea-deep', '#0b2440'),
    land: resolveColor('--color-stage-land', '#2e3a2b'),
    landHover: resolveColor('--color-stage-land-hover', '#598a63'),
    landLit: resolveColor('--color-stage-land-lit', '#79b089'),
    border: resolveColor('--color-stage-border', '#6a8497'),
    desert: resolveColor('--color-stage-desert', '#c2a370'),
    mountain: resolveColor('--color-stage-mountain', '#6f6558'),
    plateau: resolveColor('--color-stage-plateau', '#8b8358'),
    tundra: resolveColor('--color-stage-tundra', '#9aa8a0'),
    tropical: resolveColor('--color-stage-tropical', '#2f6b40'),
    ice: resolveColor('--color-stage-ice', '#e8f2fb'),
    snow: resolveColor('--color-stage-snow', '#d4e4f2'),
    shelf: resolveColor('--color-stage-shelf', '#4b86b4'),
    atmosphere: resolveColor('--color-stage-atmosphere', '#5fb3e6'),
    night: resolveColor('--color-stage-night', '#060914'),
    twilight: resolveColor('--color-stage-twilight', '#f0a35c'),
    cityLight: resolveColor('--color-stage-city-light', '#ffd9a0'),
    cityLightDim: resolveColor('--color-stage-city-light-dim', '#c98a3a'),
    route: resolveColor('--color-stage-route', '#c6bdf5'),
    accent: resolveColor('--color-stage-accent', '#b9a8f2'),
    origin: resolveColor('--color-stage-origin', '#f2c46a'),
    chip: resolveColor('--color-stage-chip', '#fbfbfd'),
  };
}

/**
 * The opening view: the whole planet, filling its box, facing the traveller.
 *
 * Not a fit to the chips. Fitting a planet-wide set of places lands on a zoom
 * that leaves the sphere small and off-centre, and fitting a handful of
 * nearby places zooms in until the globe is a flat map with rounded corners,
 * which is the thing this component exists not to be. So the zoom comes from
 * the box - the largest sphere that fits it - and the centre is the departure
 * airport, nudged south so the northern hemisphere sits high in the frame
 * and the places one can fly to from it fill the rest.
 */
function overview(
  container: HTMLElement,
  origins: readonly StageOrigin[],
  chips: readonly StageChip[],
  stage = false,
  seasonDate?: string,
): { center: [number, number]; zoom: number } {
  const anchor = origins[0]?.position ?? chips[0]?.position ?? [16, 40];
  /*
   * On the front page the planet is sized to the window, not to its box: the
   * box is the whole hero and the sphere bleeds past its sides on a phone.
   */
  const side = stage
    ? // The painted disc is about 0.855 of `side` (see the note below), so ask
      // for the diameter the design wants divided by that.
      heroDiameter(window.innerWidth, window.innerHeight) * STAGE_FIT
    : (() => {
        const frame = frameOf(container);
        return frame
          ? Math.min(frame.width, frame.height)
          : Math.min(container.clientWidth, container.clientHeight);
      })();
  // MapLibre draws the globe with the mercator world's width as its
  // circumference: 512px at zoom zero, doubling per level. So its diameter
  // is 512 · 2^zoom / π, about 163px at zoom zero.
  //
  /*
   * The factor is in the projection's units, not in pixels on the glass.
   *
   * `512 · 2^zoom / π` is how big the sphere is to the projection; the
   * perspective camera paints a disc about six sevenths of that. So a factor
   * of one here is a planet filling roughly six sevenths of its box, and this
   * asks for a little more than that - close to the edges, with the couple of
   * per cent of margin that stops the front page's globe reading as cut off
   * by the navigation above it.
   *
   * Anything that has to line up with the *edge* of the planet measures it
   * instead - see `measureSilhouette` in `globe-arcs.ts`.
   */
  const zoom = Math.log2((side * 1.02) / (512 / Math.PI));

  /*
   * On the front page the opening view is turned towards the sun where that
   * can be done without losing the home airport (see `globe-camera.ts`). The
   * terminator itself is the real one; only which half is on screen is chosen.
   */
  const center: [number, number] =
    stage && seasonDate
      ? restingCentre({
          home: { lng: anchor[0], lat: anchor[1] },
          sun: sunPosition(seasonDate as Parameters<typeof sunPosition>[0], minutesIntoUtcDay()),
        })
      : [anchor[0], Math.max(-30, Math.min(30, anchor[1] - 12))];

  return {
    center,
    zoom: Math.max(-1, Math.min(zoom, stage ? 3 : 2.6)),
  };
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

export function GlobeStage({
  chips,
  origins,
  routes,
  points,
  landUrl,
  iceUrl,
  placesUrl,
  countriesUrl,
  countriesDetailUrl,
  physicalUrl,
  cityLightsUrl,
  coastlineUrl,
  seasonDate,
  regionsUrl,
  provenance,
  countryCounts,
  selectedCountry,
  navigation,
  variant = 'hero',
  className,
}: GlobeStageProps) {
  const router = useRouter();
  const container = React.useRef<HTMLDivElement>(null);
  /** The box the sphere is measured against, and where its CSS variables live. */
  const rootRef = React.useRef<HTMLDivElement>(null);
  /** The arcs that fly over the planet, drawn outside the canvas. */
  const arcsRef = React.useRef<SVGSVGElement>(null);
  const mapRef = React.useRef<MapLibreMap | null>(null);
  /** Where the sun is, shared by the terminator timer and the ocean's sheen. */
  const sunRef = React.useRef<SunPosition | null>(null);
  const markersRef = React.useRef(new Map<string, Marker>());
  const hoveredRef = React.useRef<string | null>(null);
  const selectedRef = React.useRef<string | null>(null);
  const spinningRef = React.useRef(false);
  /**
   * Whether the hero is on screen enough to be worth animating: at least a
   * fifth of it. Every loop that only decorates reads this and stands down.
   */
  const visibleRef = React.useRef(true);
  /** True while the camera is parked on a destination the rail pointed at. */
  const flownRef = React.useRef(false);
  /** The destination the camera was pointed at, so only its arc is shown. */
  const focusedRef = React.useRef<string | null>(null);
  /** Which projection the camera is in, readable from the creation effect. */
  const projectionRef = React.useRef<'globe' | 'mercator'>('globe');
  const stage = variant === 'stage';
  /** Re-runs the label pass. Assigned once the map exists. */
  const layoutRef = React.useRef<() => void>(() => {});
  /** Re-measures where labels may sit and what covers the globe. Resize only. */
  const geometryRef = React.useRef<() => void>(() => {});
  /** Each pin's size, measured once per render of the chips. */
  const chipSizesRef = React.useRef(new Map<string, { width: number; height: number }>());
  /** The name labels currently in the DOM, shown or fading. */
  const namesRef = React.useRef(
    new Map<string, { marker: Marker; place: LabelPlace; hiddenSince: number | null }>(),
  );
  /** Every nameable place, loaded once the planet is on screen. */
  const catalogueRef = React.useRef<readonly LabelPlace[]>([]);
  /** Lights a country on every outline source. Assigned once the map exists. */
  const countryStateRef = React.useRef<
    (adm0: string, state: { hover?: boolean; selected?: boolean }) => void
  >(() => {});

  // The latest props, readable from handlers registered once at creation.
  // Written in an effect rather than during render, so a render that is
  // thrown away by React never leaks its props into a live handler.
  const latest = React.useRef({ chips, countryCounts, navigation, selectedCountry });
  React.useEffect(() => {
    latest.current = { chips, countryCounts, navigation, selectedCountry };
  });

  /*
   * What the creation effect's long-lived handlers read.
   *
   * The globe is mounted once above every stage page, so the page it is on,
   * the home airport and the box it fills all change under handlers that were
   * registered at creation. They read these rather than closing over the
   * first render's values.
   */
  const live = React.useRef({ variant, origins, seasonDate });
  React.useEffect(() => {
    live.current = { variant, origins, seasonDate };
  });
  /** The zoom the sphere rests at, so a resize refits only a globe nobody has zoomed. */
  const restingZoomRef = React.useRef(0);
  /** True while the camera is easing between the hero and explorer compositions. */
  const reframingRef = React.useRef(false);
  /** The composition the camera was last framed for. */
  const previousVariant = React.useRef(variant);

  const [status, setStatus] = React.useState<'loading' | 'ready' | 'failed'>('loading');
  /** Which kind of place the middle of the view is over, for the weather. */
  const [biome, setBiome] = React.useState<SurfaceKind | null>(null);
  const [hosts, setHosts] = React.useState<Readonly<Record<string, HTMLElement>>>({});
  /**
   * Globe or flat map.
   *
   * Deliberately component state rather than a query parameter, unlike every
   * other control on this surface. A country, a ranking and a search are
   * answers and belong in a URL somebody can send to somebody else; which
   * projection you prefer to read them on is not an answer, and a link that
   * carried it would be telling the recipient how to look.
   */
  const [projection, setProjection] = React.useState<'globe' | 'mercator'>('globe');
  /** The prices already compared against what was last seen, so it happens once. */
  const comparedRef = React.useRef(false);

  React.useEffect(() => {
    projectionRef.current = projection;
  }, [projection]);

  /*
   * Is the hero on screen?
   *
   * Idle rotation, the arcs' travelling light and the weather all stop when
   * less than a fifth of the hero is visible. Nobody is looking, and a WebGL
   * repaint is the most expensive thing on the page.
   */
  React.useEffect(() => {
    const root = rootRef.current;
    if (!root || typeof IntersectionObserver === 'undefined') return;

    // The host's box is the hero on the front page and the column on the explorer.
    const target = root.closest('[data-stage-host]') ?? root;
    const observer = new IntersectionObserver(
      ([entry]) => {
        visibleRef.current = (entry?.intersectionRatio ?? 1) >= 0.2;
      },
      { threshold: [0, 0.1, 0.2, 0.3, 0.5, 1] },
    );
    observer.observe(target);

    return () => observer.disconnect();
  }, []);

  /* ------------------------------------------------------------------ */
  /* Creation, once.                                                     */
  /* ------------------------------------------------------------------ */
  React.useEffect(() => {
    const element = container.current;
    if (!element) return;

    // Captured now: by the time the cleanup runs the ref may point elsewhere.
    const markers = markersRef.current;

    let cancelled = false;
    let stopSpin: (() => void) | null = null;
    let detailAdded = false;
    let stopResizing: (() => void) | null = null;

    const build = async () => {
      try {
        // Imported here rather than at module scope: it is a large library
        // that only the browser needs, and the page must render without it.
        const maplibre = await import('maplibre-gl');
        if (cancelled) return;

        /*
         * Point MapLibre at its own worker, served from our origin under the
         * library's version. See scripts/copy-map-worker.mjs for why the
         * default resolution fails after bundling, silently.
         */
        maplibre.setWorkerUrl(`/maplibre/${maplibre.getVersion()}/maplibre-gl-worker.mjs`);

        const colors = stageColors();
        const initial = latest.current;

        const map = new maplibre.Map({
          container: element,
          center: FALLBACK_VIEW.center,
          zoom: FALLBACK_VIEW.zoom,
          // Low enough that the whole sphere fits a phone-width box: a globe
          // that cannot be seen whole is a map.
          minZoom: -1,
          maxZoom: 6,
          /*
           * No "use ctrl + scroll to zoom" overlay.
           *
           * Cooperative gestures solve a real problem - a hero that eats the
           * page scroll is a hero nobody can scroll past - but they solve it
           * by putting a notice over the map, which reads as the map being
           * broken. So the hero simply does not zoom on scroll: the page
           * scrolls, the globe turns under the pointer, and the two buttons
           * zoom it. The explorer is a page about a map, so there the wheel
           * does what a wheel does.
           */
          scrollZoom: live.current.variant === 'explorer',
          /*
           * No attribution control.
           *
           * Natural Earth is public domain and its licence says in as many
           * words that crediting the authors is unnecessary. The credit was a
           * courtesy rather than an obligation, and it is not one the product
           * owner wants on the map. Where every shape on the globe comes from
           * is recorded in `docs/map-options.md` instead.
           */
          attributionControl: false,
          style: buildGlobeStyle({
            colors,
            // The season of the month being looked at, never the weather on the day.
            earthTilesUrl: earthTilesUrl(earthMonthOf(seasonDate)),
            landUrl,
            iceUrl,
            placesUrl,
            countriesUrl,
            physicalUrl,
            cityLightsUrl,
            coastlineUrl,
            routes,
            points,
            sun: sunGeoJson(sunPosition(seasonDate, minutesIntoUtcDay())),
            solar: solarFactors(sunPosition(seasonDate, minutesIntoUtcDay())),
          }),
        });

        /*
         * Out of the tab order and out of the accessibility tree - the
         * canvas only. The container keeps its chips, which are the content.
         */
        /*
         * The patterns the style asks for, made when it asks.
         *
         * The resolver is the documented seam for generating an image on
         * demand, and it is the right one here: it is asked once per name,
         * when a layer first needs it, which keeps the textures out of the
         * start-up path of a page that may never draw a globe at all.
         */
        map.setMissingStyleImageResolver((id: string) => {
          const make = GLOBE_TEXTURES[id];
          if (!make || map.hasImage(id)) return;

          const image = make();
          if (image) map.addImage(id, image, { pixelRatio: 2 });
        });

        const canvas = map.getCanvas();
        canvas.setAttribute('tabindex', '-1');
        canvas.setAttribute('aria-hidden', 'true');

        // A tooltip for the country under the pointer. DOM, not map text.
        const popup = new maplibre.Popup({
          closeButton: false,
          closeOnClick: false,
          offset: 12,
          maxWidth: '18rem',
          locationOccludedOpacity: 0,
        });

        /*
         * Hover and selection apply to every outline source on the map.
         *
         * Once the finer coastlines have been added there are two, keyed the
         * same way, and the one being drawn depends on the zoom. Setting the
         * state on both means a country stays lit through the swap rather
         * than going dark the moment somebody zooms far enough in to care.
         */
        const setCountryState = (adm0: string, state: { hover?: boolean; selected?: boolean }) => {
          for (const source of WORLD_SOURCES) {
            if (map.getSource(source)) map.setFeatureState({ source, id: adm0 }, state);
          }
        };

        countryStateRef.current = setCountryState;

        const setHover = (adm0: string | null) => {
          if (hoveredRef.current && hoveredRef.current !== adm0) {
            setCountryState(hoveredRef.current, { hover: false });
          }
          if (adm0) setCountryState(adm0, { hover: true });
          hoveredRef.current = adm0;
        };

        /*
         * The finer coastlines, once somebody has zoomed in far enough to see
         * that the globe-scale ones are angular.
         *
         * Added rather than swapped in: the coarse source stays, because it
         * carries the labels and because a source removed mid-interaction
         * takes its feature state with it. The coarse fill and border simply
         * stop drawing.
         */
        const addDetail = () => {
          if (detailAdded || map.getZoom() < DETAIL_ZOOM) return;

          // A style still settling cannot take a new source. Waiting rather
          // than giving up, because the zoom that asked for the detail may be
          // the last one and a map that then never loaded it would just keep
          // drawing the coarse outline.
          if (!map.isStyleLoaded()) {
            whenStyleReady(map, addDetail);
            return;
          }

          detailAdded = true;

          map.addSource('world-detail', {
            type: 'geojson',
            data: countriesDetailUrl,
            promoteId: 'adm0',
          });

          /*
           * The finer outlines are a hit target, not a drawing.
           *
           * Nothing visible changes when this arrives - the land is already
           * the 50m dissolved silhouette at every zoom. What gets finer is
           * which country a pixel belongs to, which matters once somebody has
           * zoomed in far enough to be pointing at one country rather than at
           * a continent.
           */
          map.addLayer({
            id: 'countries-detail',
            type: 'fill',
            source: 'world-detail',
            paint: {
              'fill-color': map.getPaintProperty('countries', 'fill-color') as never,
              'fill-opacity': map.getPaintProperty('countries', 'fill-opacity') as never,
              'fill-antialias': false,
            },
          });

          map.setLayoutProperty('countries', 'visibility', 'none');

          // Whatever was lit before the swap is lit after it.
          if (hoveredRef.current) setCountryState(hoveredRef.current, { hover: true });
          if (selectedRef.current) setCountryState(selectedRef.current, { selected: true });
        };

        map.on('zoomend', addDetail);

        /*
         * The country under the pointer.
         *
         * Named rather than inline because both outline layers need them: the
         * coarse one at globe zoom and the finer one once it has been added,
         * and a country has to behave the same whichever is being drawn. The
         * name and the count come from the coarse source's properties, which
         * the finer one does not carry - so they are read from the index the
         * page already has rather than from the feature.
         */
        const onCountryHover = (event: MapLayerMouseEvent) => {
          const feature = event.features?.[0];
          if (!feature) return;

          const adm0 = String(feature.id);
          const properties = feature.properties as { shortName?: string };
          const name = properties.shortName ?? adm0;
          const count = latest.current.countryCounts[adm0] ?? 0;

          setHover(adm0);
          canvas.style.cursor = 'pointer';

          popup
            .setLngLat(event.lngLat)
            .setText(
              count === 0
                ? `${name} · nothing priced yet`
                : `${name} · ${count} ${count === 1 ? 'place' : 'places'} priced`,
            )
            .addTo(map);
        };

        const onCountryLeave = () => {
          setHover(null);
          canvas.style.cursor = '';
          popup.remove();
        };

        const onCountryClick = (event: MapLayerMouseEvent) => {
          const feature = event.features?.[0];
          if (!feature) return;

          const adm0 = String(feature.id);
          const { path, query } = latest.current.navigation;

          // Fly at once rather than waiting for the server to say so: the
          // click should feel like the globe answered. MapLibre serialises a
          // non-scalar property, so the box may arrive as its own JSON.
          const raw = (feature.properties as { bbox?: string | number[] }).bbox;
          const bounds = typeof raw === 'string' ? (JSON.parse(raw) as number[]) : raw;

          if (bounds && bounds.length === 4) {
            map.fitBounds(
              [
                [bounds[0]!, bounds[1]!],
                [bounds[2]!, bounds[3]!],
              ],
              flightTo(map),
            );
          }

          const params = new URLSearchParams(query);
          params.set('country', adm0);
          router.push(`${path}?${params.toString()}` as never, { scroll: false });
        };

        for (const layer of ['countries', 'countries-detail'] as const) {
          map.on('mousemove', layer, onCountryHover);
          map.on('mouseleave', layer, onCountryLeave);
          map.on('click', layer, onCountryClick);
        }

        // Clicking a cluster opens it, which is the only thing a cluster can
        // usefully mean.
        map.on('click', 'clusters', (event) => {
          const feature = event.features?.[0];
          if (!feature || feature.geometry.type !== 'Point') return;

          map.easeTo({
            center: feature.geometry.coordinates as [number, number],
            zoom: map.getZoom() + 2,
          });
        });

        /*
         * Idle rotation.
         *
         * One full turn in 240 seconds, measured in time rather than in frames
         * so a 120Hz screen does not turn twice as fast. It pauses on a press,
         * while a chip is hovered, while focus is anywhere in the hero, while
         * the tab is hidden or the hero is mostly off screen, and while a
         * country is selected or the camera is flying - a selection that
         * drifts away is the interface disagreeing with itself. It resumes
         * three seconds after the last interaction and ramps up over 1200ms
         * rather than lurching. Off entirely under reduced motion.
         */
        const startSpin = () => {
          if (prefersReducedMotion() || spinningRef.current) return;
          spinningRef.current = true;

          const holds = { pointer: false, chip: false, focus: false };
          // Focus anywhere in the hero's copy or in the globe's own box holds the turn.
          const inScope = (node: EventTarget | null) =>
            node instanceof Element && node.closest('[data-hero], [data-stage-host]') !== null;
          // Quiet already, so the first ramp starts as soon as the globe is up.
          let lastTouch = performance.now() - SPIN_RESUME_DELAY_MS;
          const touch = () => {
            lastTouch = performance.now();
          };

          const onDown = () => {
            holds.pointer = true;
            touch();
          };
          const onUp = () => {
            holds.pointer = false;
            touch();
          };
          const onOver = (event: Event) => {
            if ((event.target as Element | null)?.closest?.('.voyagr-chip')) holds.chip = true;
          };
          const onOut = (event: Event) => {
            if ((event.target as Element | null)?.closest?.('.voyagr-chip')) {
              holds.chip = false;
              touch();
            }
          };
          const onFocusIn = (event: FocusEvent) => {
            if (!inScope(event.target)) return;
            holds.focus = true;
            touch();
          };
          const onFocusOut = (event: FocusEvent) => {
            if (!inScope(event.relatedTarget)) {
              holds.focus = false;
              touch();
            }
          };

          for (const type of ['mousedown', 'touchstart'] as const) {
            canvas.addEventListener(type, onDown, { passive: true });
          }
          for (const type of ['mouseup', 'touchend', 'touchcancel'] as const) {
            window.addEventListener(type, onUp, { passive: true });
          }
          for (const type of ['wheel', 'keydown'] as const) {
            canvas.addEventListener(type, touch, { passive: true });
          }
          element.addEventListener('mouseover', onOver);
          element.addEventListener('mouseout', onOut);
          document.addEventListener('focusin', onFocusIn);
          document.addEventListener('focusout', onFocusOut);

          let frame = 0;
          let previous = performance.now();

          const step = (now: number) => {
            frame = window.requestAnimationFrame(step);

            // Capped, so a tab that was asleep does not turn the planet a
            // quarter of the way round on waking.
            const seconds = Math.min(0.1, (now - previous) / 1000);
            previous = now;

            if (holds.pointer || holds.chip || holds.focus) {
              touch();
              return;
            }

            const standingDown =
              document.hidden ||
              !visibleRef.current ||
              flownRef.current ||
              projectionRef.current !== 'globe' ||
              latest.current.selectedCountry !== null ||
              map.isMoving();

            if (standingDown) {
              // Not an interaction, so no three-second wait - only the ramp.
              lastTouch = now - SPIN_RESUME_DELAY_MS;
              return;
            }

            const factor = spinFactor(now - lastTouch);
            if (factor <= 0) return;

            const center = map.getCenter();
            map.jumpTo({
              center: [center.lng + SPIN_DEGREES_PER_SECOND * factor * seconds, center.lat],
            });
          };
          frame = window.requestAnimationFrame(step);

          stopSpin = () => {
            spinningRef.current = false;
            window.cancelAnimationFrame(frame);
            for (const type of ['mousedown', 'touchstart'] as const) {
              canvas.removeEventListener(type, onDown);
            }
            for (const type of ['mouseup', 'touchend', 'touchcancel'] as const) {
              window.removeEventListener(type, onUp);
            }
            for (const type of ['wheel', 'keydown'] as const) {
              canvas.removeEventListener(type, touch);
            }
            element.removeEventListener('mouseover', onOver);
            element.removeEventListener('mouseout', onOut);
            document.removeEventListener('focusin', onFocusIn);
            document.removeEventListener('focusout', onFocusOut);
          };
        };

        /*
         * Which places carry a label, chosen from the view.
         *
         * Every pass picks the labelled set again from what faces the camera:
         * priced pins first by rank, then the largest unpriced cities as
         * names, up to a budget that grows as the camera closes in, with
         * hysteresis at the limb so nothing flickers (see `globe-labels.ts`).
         * A hidden pin leaves the tab order with its visibility, and the rail
         * still lists every one.
         *
         * **No layout is read per pass.** Positions come from `map.project`,
         * sizes are measured once per chip (and by `measureText` for names),
         * and the overlays and the region are measured only when something
         * resizes. MapLibre already moves every marker by transform; the pass
         * only toggles classes.
         */
        const geometry: { region: Rect | null; obstacles: Rect[] } = {
          region: null,
          obstacles: [],
        };

        const refreshGeometry = () => {
          const box = element.getBoundingClientRect();
          if (box.width === 0 || box.height === 0) return;

          const local = (rect: { left: number; top: number; right: number; bottom: number }) => ({
            left: rect.left - box.left,
            top: rect.top - box.top,
            right: rect.right - box.left,
            bottom: rect.bottom - box.top,
          });

          // Opaque panels and controls over the globe: a label under one is unreadable.
          geometry.obstacles = [...document.querySelectorAll('[data-globe-overlay]')]
            .map((overlay) => overlay.getBoundingClientRect())
            .filter((rect) => rect.width > 0)
            .map(local);

          // Labels stay inside the page's box for the globe, not the canvas,
          // which can run past it (full-bleed on the explorer).
          const frame =
            document
              .querySelector(`[data-stage-slot='${live.current.variant}']`)
              ?.getBoundingClientRect() ?? box;

          // Where the slot sits inside the canvas, for the camera's padding and the edge fade.
          const insets = [
            frame.top - box.top,
            box.right - frame.right,
            box.bottom - frame.bottom,
            frame.left - box.left,
            frame.width,
            frame.height,
          ].map((value) => Math.round(value));
          element.dataset.frame = insets.join(',');
          const root = rootRef.current;
          if (root) {
            for (const [index, side] of ['top', 'right', 'bottom', 'left'].entries()) {
              root.style.setProperty(`--frame-${side}`, `${Math.max(0, insets[index]!)}px`);
            }
          }

          const margin = 8;
          geometry.region = local({
            left: Math.max(frame.left, box.left, 0) + margin,
            top: Math.max(frame.top, box.top) + margin,
            right: Math.min(frame.right, box.right, window.innerWidth) - margin,
            bottom: Math.min(frame.bottom, box.bottom) - margin,
          });
        };
        geometryRef.current = refreshGeometry;

        /** A name's width without reading layout: the same font the label is set in. */
        const measure = document.createElement('canvas').getContext('2d');
        const nameWidths = new Map<string, number>();
        let nameFont: string | null = null;
        const nameWidth = (city: string) => {
          const known = nameWidths.get(city);
          if (known !== undefined) return known;
          nameFont ??= `500 12px ${getComputedStyle(element).fontFamily}`;
          let text = city.length * 7;
          if (measure) {
            measure.font = nameFont;
            text = measure.measureText(city).width;
          }
          // Padding (8 + 8), the dot (6) and its gap (6), and a pixel of rounding.
          const width = Math.ceil(text) + 29;
          nameWidths.set(city, width);
          return width;
        };
        const NAME_HEIGHT = 23;

        /** A pin's size, measured once and kept until the chips change. */
        const chipSize = (code: string, marker: Marker) => {
          const known = chipSizesRef.current.get(code);
          if (known) return known;
          const face = marker.getElement().firstElementChild;
          if (!face) return null;
          const rect = face.getBoundingClientRect();
          if (rect.width === 0) return null;
          const size = { width: Math.ceil(rect.width), height: Math.ceil(rect.height) };
          chipSizesRef.current.set(code, size);
          return size;
        };

        /*
         * Written only when the answer changes: a class change is a style
         * invalidation, and doing it to every label on every pass was once
         * enough to halve the frame rate.
         */
        const setCollided = (host: HTMLElement, on: boolean) => {
          if (host.classList.contains('voyagr-chip-collided') !== on) {
            host.classList.toggle('voyagr-chip-collided', on);
          }
        };

        /** Which way the words read; the dot stays on the coordinate either way. */
        const orient = (marker: Marker, left: boolean, width: number) => {
          const host = marker.getElement();
          if (host.classList.contains('voyagr-chip-left') === left) return;
          host.classList.toggle('voyagr-chip-left', left);
          marker.setOffset(left ? [DOT_INSET - width, 0] : [-DOT_INSET, 0]);
        };

        const names = new Map<
          string,
          { marker: Marker; place: LabelPlace; hiddenSince: number | null }
        >();
        namesRef.current = names;

        const createName = (place: LabelPlace) => {
          const host = document.createElement('div');
          host.className = 'voyagr-label-host voyagr-chip-collided';

          const link = document.createElement('a');
          link.href = `/?edit=1&destinations=${place.code}`;
          link.className = 'voyagr-chip voyagr-chip-name stage-scope';
          link.dataset.destination = place.code;
          link.setAttribute('aria-label', placeLinkLabel(place));

          const dot = document.createElement('span');
          dot.className = 'voyagr-chip-dot';
          dot.setAttribute('aria-hidden', 'true');
          const text = document.createElement('span');
          text.textContent = place.city;
          link.append(dot, text);
          host.append(link);

          const marker = new maplibre.Marker({
            element: host,
            anchor: 'left',
            offset: [-DOT_INSET, 0],
            opacityWhenCovered: 0,
          })
            .setLngLat([place.lng, place.lat])
            .addTo(map);

          return { marker, place, hiddenSince: null as number | null };
        };

        let shownIds = new Set<string>();

        const layoutChips = () => {
          if (!geometry.region) refreshGeometry();
          const region = geometry.region;
          if (!region) return;

          const globe = projectionRef.current === 'globe';
          const centre = map.getCenter();
          const view = { lng: centre.lng, lat: centre.lat } as SphereFrame;
          const zoomAbove = map.getZoom() - restingZoomRef.current;
          const phone = window.innerWidth < PHONE_MAX_WIDTH;
          const onStage = live.current.variant === 'stage';
          /*
           * How far from the visible edge a place is, as the cosine of its
           * apparent angle: 1 in the middle of the disc, 0 at the limb.
           *
           * Measured on screen against the silhouette, not on the sphere. The
           * camera is close enough that it sees well under a hemisphere, so a
           * place 70 degrees round is already on the limb as drawn - a rule
           * written in degrees on the sphere left labels hanging off the edge
           * of the planet. The far side is cut first, cheaply.
           */
          const sphere = globe ? readSphere(map, true) : null;
          const radius = sphere ? sphere.diameter / 2 : 0;
          const points = new Map<string, { x: number; y: number } | null>();
          const pointOf = (id: string, lng: number, lat: number) => {
            if (points.has(id)) return points.get(id)!;
            const point = map.project([lng, lat]);
            const at =
              Number.isFinite(point.x) && Number.isFinite(point.y)
                ? { x: point.x, y: point.y }
                : null;
            points.set(id, at);
            return at;
          };
          const face = (id: string, lng: number, lat: number) => {
            if (!sphere || radius <= 0) return 1;
            if (facing(lng, lat, view) < 0.1) return 0;
            const at = pointOf(id, lng, lat);
            if (!at) return 0;
            const fraction = Math.hypot(at.x - sphere.x, at.y - sphere.y) / radius;
            return fraction >= 1 ? 0 : Math.sqrt(1 - fraction * fraction);
          };

          const candidates: LabelCandidate[] = [];
          const cosines = new Map<string, number>();
          const taken = new Set<string>();
          const takenCities = new Set<string>();

          for (const chip of latest.current.chips) {
            taken.add(chip.destination);
            takenCities.add(chip.name.toLowerCase());

            const marker = markers.get(chip.destination);
            if (!marker || marker.getElement().hasAttribute('data-leaving')) continue;
            const cosine = face(`pin:${chip.destination}`, chip.position[0], chip.position[1]);
            if (cosine < LIMB_EXIT_COSINE) continue;
            const size = chipSize(chip.destination, marker);
            if (!size) continue;

            const id = `pin:${chip.destination}`;
            cosines.set(id, cosine);
            candidates.push({
              id,
              lng: chip.position[0],
              lat: chip.position[1],
              priced: true,
              order: chip.rank,
              width: size.width,
              height: size.height,
            });
          }

          // The home airport has its own node; naming it again is noise.
          for (const origin of live.current.origins) taken.add(origin.code);

          const tierTwo = zoomAbove >= TIER_TWO_ZOOM;
          for (const place of catalogueRef.current) {
            if (place.tier === 2 && !tierTwo) continue;
            if (taken.has(place.code) || takenCities.has(place.city.toLowerCase())) continue;
            const cosine = face(`name:${place.code}`, place.lng, place.lat);
            if (cosine < LIMB_EXIT_COSINE) continue;

            const id = `name:${place.code}`;
            cosines.set(id, cosine);
            candidates.push({
              id,
              lng: place.lng,
              lat: place.lat,
              priced: false,
              order: -place.population,
              width: nameWidth(place.city),
              height: NAME_HEIGHT,
            });
          }

          // On the front page a label stands away from its home airport's arc.
          const home = live.current.origins[0];
          const homeX =
            onStage && home ? map.project([home.position[0], home.position[1]]).x : null;

          const shown = chooseLabels({
            candidates,
            project: (candidate) => pointOf(candidate.id, candidate.lng, candidate.lat),
            cosine: (candidate) => cosines.get(candidate.id) ?? 0,
            previous: shownIds,
            budget: labelBudget(zoomAbove, phone),
            // The explorer is a page about its results: every one that fits.
            pricedUnlimited: !onStage,
            region,
            obstacles: geometry.obstacles,
            preferLeft: homeX === null ? undefined : (_candidate, x) => homeX > x,
          });
          shownIds = new Set(shown.keys());

          for (const [code, marker] of markers) {
            const placed = shown.get(`pin:${code}`);
            setCollided(marker.getElement(), !placed);
            const size = chipSizesRef.current.get(code);
            if (placed && size) orient(marker, placed.left, size.width);
          }

          const now = performance.now();
          for (const [id, placed] of shown) {
            if (!id.startsWith('name:')) continue;
            const code = id.slice(5);
            let entry = names.get(code);
            if (!entry) {
              const place = catalogueRef.current.find((candidate) => candidate.code === code);
              if (!place) continue;
              entry = createName(place);
              names.set(code, entry);
            }
            entry.hiddenSince = null;
            orient(entry.marker, placed.left, nameWidth(entry.place.city));
            setCollided(entry.marker.getElement(), false);
          }

          // Faded out, then removed once it has been gone a while: the DOM holds
          // what is on screen and what just left, never the whole catalogue.
          for (const [code, entry] of names) {
            if (shown.has(`name:${code}`)) continue;
            setCollided(entry.marker.getElement(), true);
            entry.hiddenSince ??= now;
            if (now - entry.hiddenSince > 2_000) {
              entry.marker.remove();
              names.delete(code);
            }
          }
        };

        let layoutPending = false;
        const scheduleLayout = () => {
          if (layoutPending) return;
          layoutPending = true;
          window.requestAnimationFrame(() => {
            layoutPending = false;
            lastLayout = performance.now();
            layoutChips();
          });
        };

        /*
         * One pass per camera move, at most ten a second while it moves and
         * once more when it stops. MapLibre moves the labels every frame; this
         * only decides which of them are shown.
         */
        const THROTTLE_MS = 100;
        let lastLayout = 0;

        const onMove = () => {
          if (performance.now() - lastLayout < THROTTLE_MS) return;
          scheduleLayout();
        };

        /*
         * What the middle of the view is over.
         *
         * Read from the same pure model the bands were built from. Only on
         * `moveend`, because the page's tint does not need to change sixty
         * times a second while somebody spins the planet.
         */
        const readBiome = () => {
          setBiome(bandFor(map.getCenter().lat, sunLatitude(live.current.seasonDate)).kind);
        };

        map.on('move', onMove);
        map.on('moveend', scheduleLayout);
        map.on('moveend', readBiome);
        layoutRef.current = scheduleLayout;

        map.once('load', () => {
          window.clearTimeout(blankGuard);
          if (cancelled) return;

          // The origins, routes and destinations are all filled by the effect
          // below, which runs as soon as this sets `ready`. Only the opening
          // view belongs here, because it needs the container's real size.
          const opening = live.current;
          // The opening view is already the right composition for this page.
          previousVariant.current = opening.variant;
          refreshGeometry();
          map.setPadding(
            opening.variant === 'stage'
              ? stagePadding(window.innerWidth)
              : explorerPadding(element),
          );
          map.jumpTo(
            overview(
              element,
              opening.origins,
              initial.chips,
              opening.variant === 'stage',
              opening.seasonDate,
            ),
          );

          /*
           * Follows the box.
           *
           * MapLibre only listens for the *window* resizing, and the opening
           * zoom is worked out from the box once, so changing the window while
           * the page was open left a globe sized for the old box, clipped or
           * floating in the new one. The container is observed instead, which
           * also catches a sidebar opening or a layout reflow. The sphere is
           * refitted only while it is still at its resting size: somebody who
           * has zoomed in keeps the view they chose, and only the canvas is
           * resized under it.
           */
          restingZoomRef.current = map.getZoom();
          let frame = 0;
          const observer = new ResizeObserver(() => {
            window.cancelAnimationFrame(frame);
            frame = window.requestAnimationFrame(() => {
              if (cancelled) return;
              map.resize();
              refreshGeometry();
              // While the camera is easing between compositions it owns the
              // padding and the zoom; refitting here would snap it.
              if (reframingRef.current) {
                layoutRef.current?.();
                return;
              }

              const now = live.current;
              map.setPadding(
                now.variant === 'stage'
                  ? stagePadding(window.innerWidth)
                  : explorerPadding(element),
              );

              const fitted = overview(
                element,
                now.origins,
                latest.current.chips,
                now.variant === 'stage',
                now.seasonDate,
              );
              if (Math.abs(map.getZoom() - restingZoomRef.current) < 0.05) {
                map.jumpTo({ zoom: fitted.zoom });
                restingZoomRef.current = fitted.zoom;
              }
              layoutRef.current?.();
            });
          });
          observer.observe(element);

          // The slot moved inside an unchanged canvas: re-measure, and re-centre on it.
          const onFrame = () => {
            refreshGeometry();
            if (live.current.variant === 'explorer' && !reframingRef.current) {
              map.setPadding(explorerPadding(element));
            }
            scheduleLayout();
          };
          window.addEventListener(STAGE_FRAME_EVENT, onFrame);

          stopResizing = () => {
            window.cancelAnimationFrame(frame);
            observer.disconnect();
            window.removeEventListener(STAGE_FRAME_EVENT, onFrame);
          };

          if (initial.selectedCountry) {
            const [w, s, e, n] = initial.selectedCountry.bbox;
            setCountryState(initial.selectedCountry.adm0, { selected: true });
            selectedRef.current = initial.selectedCountry.adm0;
            map.fitBounds(
              [
                [w!, s!],
                [e!, n!],
              ],
              { ...flightTo(map), duration: 0 },
            );
          }

          startSpin();

          /*
           * The decoration, now that the planet is on screen. `setData` takes
           * a URL, so this is the same fetch the style would have made -
           * moved to after the first paint rather than before it.
           */
          (map.getSource('coastline') as GeoJSONSource | undefined)?.setData(coastlineUrl);
          (map.getSource('city-lights') as GeoJSONSource | undefined)?.setData(cityLightsUrl);

          mapRef.current = map;
          // Automation only: lets a browser test ask the map where a pin
          // belongs and compare it with where the pin was drawn.
          if (navigator.webdriver)
            (window as unknown as { __voyagrMap?: MapLibreMap }).__voyagrMap = map;
          readBiome();

          /*
           * The places that can be named, once the planet is up: a hundred
           * kilobytes nobody needs before the first paint. A failed fetch
           * leaves the priced pins, which is what the globe showed before.
           */
          void fetch(LABEL_PLACES_URL)
            .then((response) => (response.ok ? response.json() : null))
            .then((value: unknown) => {
              if (cancelled) return;
              catalogueRef.current = parseLabelPlaces(value);
              scheduleLayout();
            })
            .catch(() => {});

          setStatus('ready');
        });

        /*
         * Hide the map if it never actually loads.
         *
         * When MapLibre cannot reach its worker it renders the background,
         * reports no error at all, and never loads a source - a convincing
         * empty ocean where the world should be. An empty ocean is worse
         * than no map, because it looks like an answer.
         */
        const blankGuard = window.setTimeout(() => {
          if (!cancelled && !map.isStyleLoaded()) setStatus('failed');
        }, LOAD_TIMEOUT_MS);

        mapRef.current = map;
      } catch {
        if (!cancelled) setStatus('failed');
      }
    };

    /*
     * The globe waits for the page to be interactive.
     *
     * Creating a WebGL context, compiling its shaders and parsing a hundred
     * and eighty kilobytes of coastline is the heaviest thing this product
     * does on a main thread, and none of it is why somebody pressed a lens
     * chip. Deferring it to the first idle moment means the links, the form
     * and the rail respond immediately and the planet arrives a beat later,
     * which is the right order on a slow phone and invisible on a fast one.
     *
     * The timeout is the contract: idle or not, the globe is building within
     * a second, so a busy page never simply fails to draw it.
     */
    let cancelBuild: () => void;

    if (typeof window.requestIdleCallback === 'function') {
      const handle = window.requestIdleCallback(() => void build(), { timeout: 1_000 });
      cancelBuild = () => window.cancelIdleCallback(handle);
    } else {
      const handle = window.setTimeout(() => void build(), 200);
      cancelBuild = () => window.clearTimeout(handle);
    }

    return () => {
      cancelled = true;
      cancelBuild();
      stopSpin?.();
      stopResizing?.();
      for (const marker of markers.values()) marker.remove();
      for (const entry of namesRef.current.values()) entry.marker.remove();
      namesRef.current.clear();
      markers.clear();
      mapRef.current?.remove();
      mapRef.current = null;
    };
    // Created once. Everything that changes afterwards is applied in place
    // by the effects below, which is what keeps a selection a fly-to rather
    // than a new globe.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ------------------------------------------------------------------ */
  /* The weather moves.                                                  */
  /* ------------------------------------------------------------------ */
  /**
   * What is alive on the planet, and what deliberately is not.
   *
   * Three things move: the snow glitters, the sand drifts, and the dashes
   * walk along each route. All three are slow, none of them is a particle
   * system over the canvas - that was tried and rightly disliked - and none of
   * them changes a figure, a shape or a position. They are the surface of the
   * planet behaving like a surface.
   *
   * **Off entirely under `prefers-reduced-motion`.** Not slowed: off. The
   * globe is still a globe, the snow is still snow, and nobody who has asked
   * their machine to stop animating things has to watch the desert breathe.
   *
   * Twelve frames a second, because none of these is fast enough for anybody
   * to see the difference and a WebGL repaint is not free.
   */
  React.useEffect(() => {
    const map = mapRef.current;
    if (!map || status !== 'ready') return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const started = performance.now();
    let frame = 0;
    // The dash position last written, so an unchanged frame writes nothing.
    let lastDash = -1;
    let lastShimmer = Number.NaN;
    let lastSandX = Number.NaN;
    let lastSandY = Number.NaN;
    let last = 0;

    const step = (now: number) => {
      frame = window.requestAnimationFrame(step);

      // A hidden tab still gets frames in some engines, and repainting a
      // planet nobody is looking at is the definition of wasted battery.
      if (document.hidden || !visibleRef.current) return;

      /*
       * Nothing moves until the globe has finished arriving.
       *
       * A repaint every frame while the style is still settling competes with
       * the work that settles it - the finer coastlines and an open country's
       * regions are fetched and added in that window - and on a slow machine
       * that showed up as detail that took seconds longer to appear. Decoration
       * waits for the map, never the other way round.
       */
      if (!map.isStyleLoaded()) return;

      if (now - last < 100) return;
      last = now;

      const seconds = (now - started) / 1000;

      try {
        if (map.getLayer('snow-texture')) {
          // A slow glitter, around the band's own strength rather than
          // instead of it: the ice is where the model says it is, and this
          // only changes how brightly it catches the light.
          //
          // Quantised to steps of 0.026 (five levels either side). Every
          // `setPaintProperty` restyles and repaints the whole globe, and the
          // eye cannot tell 1.039 from 1.04, so a step that did not change is
          // not written. That cut the writes from ten a second to about two.
          const shimmer = 1 + Math.round((Math.sin(seconds * 0.7) * 0.13) / 0.026) * 0.026;
          if (shimmer !== lastShimmer) {
            lastShimmer = shimmer;
            // The same shape the style declares: `zoom` at the top, the band's
            // own strength multiplied in at each stop. Without the ramp the
            // first frame of the weather flattens the texture back to full
            // strength at globe zoom, where it reads as hatching; with the
            // multiply on the outside it is not a valid expression at all.
            map.setPaintProperty('snow-texture', 'fill-opacity', [
              'interpolate',
              ['linear'],
              ['zoom'],
              0,
              ['*', ['get', 'strength'], 0.3 * shimmer],
              3,
              ['*', ['get', 'strength'], 0.9 * shimmer],
            ] as never);
          }
        }

        if (map.getLayer('desert-texture')) {
          // Sand moving across a sand sea. Pixels, not degrees: nothing about
          // where the desert is has changed. Whole pixels, and only written
          // when the pixel changes, for the same reason as the snow.
          const sandX = Math.round(Math.sin(seconds * 0.24) * 4);
          const sandY = Math.round(Math.cos(seconds * 0.17) * 3);
          if (sandX !== lastSandX || sandY !== lastSandY) {
            lastSandX = sandX;
            lastSandY = sandY;
            map.setPaintProperty('desert-texture', 'fill-translate', [sandX, sandY] as never);
          }
        }

        if (map.getLayer('routes-flow')) {
          // A fixed set of dash positions, set only when the step changes:
          // every new dash array is a permanent entry in MapLibre's line
          // atlas, and a continuous phase filled it (see `routeDashPattern`).
          const pattern = routeDashPattern(seconds);
          if (pattern[0] !== lastDash) {
            lastDash = pattern[0];
            map.setPaintProperty('routes-flow', 'line-dasharray', pattern as never);
          }
        }
      } catch {
        // A style reload between frames leaves a layer momentarily absent.
        // Skipping a frame is the whole of the correct response.
      }
    };

    // And a moment's grace after that, so the first paint of the page is not
    // sharing a thread with the first paint of the weather.
    const begin = window.setTimeout(() => {
      frame = window.requestAnimationFrame(step);
    }, 1_200);

    return () => {
      window.clearTimeout(begin);
      window.cancelAnimationFrame(frame);
    };
  }, [status]);

  /* ------------------------------------------------------------------ */
  /* The planet keeps turning.                                           */
  /* ------------------------------------------------------------------ */
  /**
   * The night is recomputed on a timer, not on a frame.
   *
   * The Earth turns a quarter of a degree a minute, so a minute is already
   * finer than anybody can see; asking for it sixty times a second would burn
   * a core to redraw the same polygon. What this buys is that a page left open
   * is never wrong about where the sun is - and that somebody watching for a
   * while sees the terminator move, which is the difference between a picture
   * of a planet and a planet.
   */
  React.useEffect(() => {
    const map = mapRef.current;
    if (!map || status !== 'ready') return;

    const paint = () => {
      const sun = sunPosition(seasonDate, minutesIntoUtcDay());
      // Shared with the ocean's sheen, so the highlight and the terminator
      // under it can never be drawn for two different times of day.
      sunRef.current = sun;

      (map.getSource('sun') as GeoJSONSource | undefined)?.setData(sunGeoJson(sun) as never);

      /*
       * Both light layers, not just the dots.
       *
       * The bloom is a second, much wider circle under each dot, and it has
       * its own copy of the fade built from the sun's longitude at the time
       * the style was made. Only the dots were being refreshed here, so an
       * hour after the page loaded the halos were fifteen degrees out of
       * date and glowing over the lit hemisphere with no lights inside them.
       * A fresh load looked perfect, which is what made it hard to see.
       */
      for (const [layer, factor] of CITY_LIGHT_LAYERS) {
        if (!map.getLayer(layer)) continue;

        map.setPaintProperty(
          layer,
          'circle-opacity',
          cityLightPaint(factor, solarFactors(sun)) as never,
        );
      }
    };

    paint();
    const timer = window.setInterval(paint, 60_000);

    return () => window.clearInterval(timer);
  }, [seasonDate, status]);

  /* ------------------------------------------------------------------ */
  /* The season of the travel month.                                     */
  /* ------------------------------------------------------------------ */
  /**
   * A different month is a different photograph, cross-faded.
   *
   * The planet shows the typical look of the month being travelled in - NASA's
   * Blue Marble for that month, snow where it snows then - never the weather on
   * the day. Picking other dates moves the month; the new month's tiles are
   * added above the old ones at zero opacity, and once they have arrived they
   * fade up over 600ms (at once under reduced motion) and the old layer is
   * removed. Only the month in use is ever fetched.
   */
  const month = earthMonthOf(seasonDate);
  const earthRef = React.useRef<{ month: string; layer: string; source: string } | null>(null);
  React.useEffect(() => {
    const map = mapRef.current;
    if (!map || status !== 'ready') return;

    // The style opened on the month it was created with, as `earth`.
    earthRef.current ??= {
      month: earthMonthOf(live.current.seasonDate),
      layer: 'earth',
      source: 'earth',
    };
    const current = earthRef.current;
    if (current.month === month) return;

    const next = { month, layer: `earth-${month}`, source: `earth-${month}` };
    const duration = prefersReducedMotion() ? 0 : 600;

    try {
      if (map.getLayer(next.layer)) map.removeLayer(next.layer);
      if (map.getSource(next.source)) map.removeSource(next.source);
      map.addSource(next.source, earthSource(month));
      const layer = earthLayer(next.layer, next.source, 0);
      map.addLayer(
        {
          ...layer,
          paint: { ...layer.paint, 'raster-opacity-transition': { duration, delay: 0 } },
        },
        map.getLayer('poles') ? 'poles' : undefined,
      );
    } catch {
      return;
    }
    earthRef.current = next;

    let started = false;
    let removeTimer = 0;
    const start = () => {
      if (started) return;
      started = true;
      map.off('sourcedata', onData);
      if (!map.getLayer(next.layer)) return;
      map.setPaintProperty(next.layer, 'raster-opacity', 1);
      removeTimer = window.setTimeout(() => {
        // Everything under the month now in use goes: a quick second change
        // can leave more than one older month behind it.
        for (const layer of map.getStyle().layers ?? []) {
          if (layer.id !== next.layer && (layer.id === 'earth' || layer.id.startsWith('earth-'))) {
            map.removeLayer(layer.id);
          }
        }
        for (const id of Object.keys(map.getStyle().sources ?? {})) {
          if (id !== next.source && (id === 'earth' || id.startsWith('earth-'))) {
            map.removeSource(id);
          }
        }
      }, duration + 100);
    };
    const onData = (event: { sourceId?: string }) => {
      if (event.sourceId === next.source && map.isSourceLoaded(next.source)) start();
    };
    map.on('sourcedata', onData);
    // Tiles that never arrive must not leave the old month up for good.
    const fallback = window.setTimeout(start, 3_000);

    return () => {
      map.off('sourcedata', onData);
      window.clearTimeout(fallback);
      window.clearTimeout(removeTimer);
    };
  }, [month, status]);

  /* ------------------------------------------------------------------ */
  /* The atmosphere, and the traffic over it.                            */
  /* ------------------------------------------------------------------ */
  /**
   * Everything drawn around the sphere rather than on it.
   *
   * Four things live here, and they share one loop because they share one
   * measurement - where the planet's silhouette is on screen this frame:
   *
   *  - **The atmosphere.** Limb darkening, the sheen where the sun strikes
   *    the ocean, the rim, and the halo beyond it. Four CSS circles sized
   *    from `--globe-diameter`; see the `voyagr-orb` rules in `globals.css`.
   *  - **The arcs.** Each route lifted off the surface and bowed over the
   *    limb, projected by `globe-arcs.ts`.
   *  - **The lights that travel them**, one per arc, which is the only thing
   *    on this surface that says these are journeys rather than lines.
   *  - **Fading all of it out** when the planet stops being a planet: zoomed
   *    past a globe, or switched to the flat map.
   *
   * Paths are recomputed only when the view has actually changed; the lights
   * move every frame along points already worked out. Under reduced motion
   * there are no lights at all, and the arcs are still drawn - a still
   * picture of the same information.
   */
  React.useEffect(() => {
    const map = mapRef.current;
    const root = rootRef.current;
    const svg = arcsRef.current;
    if (!map || !root || !svg || status !== 'ready') return;

    const NS = 'http://www.w3.org/2000/svg';
    /*
     * Every route, each as one smooth curve from the home airport.
     *
     * No bundling (a near destination drawn as a hop off another arc has a
     * corner in it). Which six are shown is decided every pass, from what is
     * on the near side: the six best-ranked of the routes you can see.
     */
    const runs = toArcRuns(routes, 30, { bundle: false });
    const moving = !prefersReducedMotion();

    /*
     * The arcs are built as DOM rather than rendered by React.
     *
     * They change thirty times a second while somebody spins the globe, and
     * a reconciliation pass per frame for a decoration that carries no text,
     * no link and no figure would be the most expensive thing on the page.
     * The chips beside them stay React, because those are content.
     */
    const keys = runs.map((run) => run.key);

    /*
     * One group per route, so its opacity is one number: fading in with the
     * hero, fading out when another destination is selected, and fading out
     * when it runs round to the far side of the planet.
     *
     * Thin blue-white luminous lines with a soft glow, and a small bright node
     * at each end. Colour no longer carries the stop count: that is in words
     * on every destination card.
     */
    const drawn = runs.map((run) => {
      const group = document.createElementNS(NS, 'g');
      const glow = document.createElementNS(NS, 'path');
      const line = document.createElementNS(NS, 'path');
      const destination = run.points[run.points.length - 1]!;
      const dest = (() => {
        const halo = document.createElementNS(NS, 'circle');
        const core = document.createElementNS(NS, 'circle');
        for (const circle of [halo, core]) circle.setAttribute('fill', 'var(--color-stage-arc)');
        halo.setAttribute('r', '7');
        halo.setAttribute('fill-opacity', '0.28');
        core.setAttribute('r', '2.6');
        core.setAttribute('fill-opacity', '1');
        core.setAttribute('data-lnglat', `${destination[0]},${destination[1]}`);
        return { halo, core };
      })();
      // One light per route: 6px across, travelling the arc once per 4s.
      const light = moving ? document.createElementNS(NS, 'circle') : null;

      /*
       * `pathLength` of 1 makes the dash arithmetic independent of the path's
       * real length, which changes every frame as the planet turns. The draw
       * is a dashoffset from 1 to 0. This is SVG, not the map's line atlas, so
       * it does not touch `routeDashPattern`'s bound.
       */
      for (const path of [glow, line]) {
        path.setAttribute('pathLength', '1');
        path.setAttribute('stroke-dasharray', '1 1');
        path.setAttribute('fill', 'none');
        path.setAttribute('stroke', 'var(--color-stage-arc)');
        path.setAttribute('stroke-linecap', 'round');
      }

      glow.setAttribute('stroke-width', '5');
      glow.setAttribute('stroke-opacity', '0.2');

      line.setAttribute('stroke-width', '1');
      line.setAttribute('stroke-opacity', '0.7');

      group.append(glow, line);
      group.append(dest.halo, dest.core);

      if (light) {
        light.setAttribute('r', '3');
        light.setAttribute('fill', 'var(--color-stage-chip-ink)');
        light.setAttribute('stroke', 'var(--color-stage-arc)');
        light.setAttribute('stroke-width', '4');
        light.setAttribute('stroke-opacity', '0.35');
        light.setAttribute('fill-opacity', '0');
        group.append(light);
      }

      group.setAttribute('opacity', '0');
      svg.append(group);

      return {
        run,
        group,
        glow,
        line,
        light,
        dest,
        allowed: false,
        shown: 1,
        written: -1,
        drawnAt: null as number | null,
      };
    });

    /*
     * One shared, brighter node at the home airport. Every route leaves from
     * the same place, so it is drawn once rather than once per arc.
     */
    const home = (() => {
      const halo = document.createElementNS(NS, 'circle');
      const core = document.createElementNS(NS, 'circle');
      for (const circle of [halo, core]) circle.setAttribute('fill', 'var(--color-stage-arc)');
      halo.setAttribute('r', '11');
      halo.setAttribute('fill-opacity', '0.34');
      core.setAttribute('r', '3.6');
      core.setAttribute('fill', '#ffffff');
      const first = runs[0]?.points[0];
      if (first) core.setAttribute('data-lnglat', `${first[0]},${first[1]}`);
      for (const circle of [halo, core]) circle.setAttribute('visibility', 'hidden');
      svg.append(halo, core);
      return { halo, core };
    })();

    /** Starts a route's 900ms draw the first time it has a path to draw. */
    const startDraw = (entry: (typeof drawn)[number], index: number, now: number) => {
      if (entry.drawnAt !== null) return;
      entry.drawnAt = now + (moving ? index * 100 : 0);
      if (!moving) {
        // Reduced motion: appears drawn, no animation at all.
        for (const path of [entry.glow, entry.line]) path.setAttribute('stroke-dasharray', 'none');
        return;
      }

      for (const path of [entry.glow, entry.line]) {
        path.animate([{ strokeDashoffset: 1 }, { strokeDashoffset: 0 }], {
          duration: ARC_DRAW_MS,
          delay: index * 100,
          easing: EASE_OUT_QUART_CSS,
          fill: 'both',
        });
      }
    };

    let frame = 0;
    let lastDraw = -1;
    let signature = '';
    // Whether the ground-track layers are currently hidden. Starts unknown so
    // the first frame always writes it.
    let groundTrackHidden: boolean | null = null;
    const arcs = new Map<string, ProjectedArc>();
    let previousFrame = performance.now();

    /*
     * Custom properties are only written when they change.
     *
     * Setting one on the root invalidates style for everything that inherits
     * it, whether or not the value is different - and this loop would
     * otherwise do that twenty-five times a second for a number that only
     * moves when somebody zooms. Caching the last string written turns a
     * still globe into no style work at all.
     */
    const written = new Map<string, string>();
    const write = (name: string, value: string) => {
      if (written.get(name) === value) return;
      written.set(name, value);
      root.style.setProperty(name, value);
    };

    const step = (now: number) => {
      frame = window.requestAnimationFrame(step);

      // A hidden tab still gets frames in some engines, and projecting a
      // planet nobody is looking at is the definition of wasted battery.
      if (document.hidden) return;
      // The map's own render already did this frame's pass.
      if (lastDraw >= 0 && now - lastDraw < 4) return;

      try {
        draw(now);
      } catch {
        /*
         * A dropped frame, not a broken page.
         *
         * Everything in here reads a map that is being changed underneath it
         * - a style reloading, a projection swapping, a source arriving - and
         * any of those can leave a transform that answers with nothing for an
         * instant. This is decoration over a canvas: the correct response to
         * one bad frame is the next frame. The weather loop below has taken
         * the same position since it was written.
         */
      }
    };

    const draw = (now: number) => {
      /*
       * The lights run at the display's rate; the projection does not.
       *
       * Recomputing three hundred screen positions is the expensive half and
       * it only has an answer worth having when the view has moved, so it
       * stays on a throttle. Moving a light along points already worked out
       * is two multiplies, and doing that every frame is the difference
       * between traffic and a strobe.
       */
      lastDraw = now;
      // Every call is a full pass: the projection runs inside MapLibre's own
      // `render` event, in the frame the map moved in, so the strings cannot
      // lag the planet. The signature below is what keeps a still globe free.
      const heavy = true;

      const globe = projection === 'globe';
      const sphere = readSphere(map, globe);

      write('--globe-diameter', `${sphere.diameter.toFixed(1)}px`);
      // Where the sphere really is: not the middle of the view once it is tilted.
      write('--globe-cx', `${sphere.x.toFixed(1)}px`);
      write('--globe-cy', `${sphere.y.toFixed(1)}px`);
      write('--globe-shown', sphere.shown.toFixed(3));

      /*
       * How far past its resting size the planet has been zoomed, 0 to 1.
       *
       * The canvas's edges fade with it (`data-bled` in `globals.css`), so a
       * zoomed planet dissolves at the edge of its box instead of being cut by
       * it, and the scrim behind the page's text comes up only once the planet
       * can reach under it. A flag as well as the number: a mask over a WebGL
       * canvas costs a composite every frame and is off while it is not needed.
       */
      const bleed = Math.max(0, Math.min(1, (map.getZoom() - restingZoomRef.current) / 0.8));
      write('--zoom-bleed', (Math.round(bleed * 20) / 20).toFixed(2));
      const bled = bleed > 0.02 ? 'true' : 'false';
      if (root.dataset.bled !== bled) root.dataset.bled = bled;

      /*
       * Once the planet has flattened into a map, the map has edges.
       *
       * A rectangle of tiles on a dark page reads as a box pasted on it, and it
       * cut the arcs and the labels off square. The flag lets CSS feather those
       * edges away (`.voyagr-map`). A flag rather than the number, because a
       * mask over a WebGL canvas costs a composite every frame and should be
       * on only while it is needed.
       */
      const flat = sphere.shown < 1 ? 'true' : 'false';
      if (root.dataset.flat !== flat) root.dataset.flat = flat;

      /*
       * One line per journey while the arcs are drawn.
       *
       * The map style also draws each route on the ground under its arc - a
       * faint copy, a dashed twin and the selected one - and with the arc
       * lifted above it that read as a second, stray line under the plane.
       * They are hidden while the arcs carry the route and come back on the
       * flat map, where there is no arc and they are the only drawing of it.
       */
      const arcsCarryRoutes = sphere.shown > 0.5;
      if (groundTrackHidden !== arcsCarryRoutes) {
        groundTrackHidden = arcsCarryRoutes;
        for (const id of ['routes', 'routes-flow', 'routes-selected']) {
          if (map.getLayer(id)) {
            map.setLayoutProperty(id, 'visibility', arcsCarryRoutes ? 'none' : 'visible');
          }
        }
      }

      if (sphere.shown === 0) return;

      /*
       * The projection is only redone when the view has moved.
       *
       * The centre and the zoom are the whole of what decides where a point
       * lands, so a signature of the two says whether three hundred matrix
       * multiplies are worth doing. While the globe idles it moves every
       * frame and they always are; while it sits still the lights keep
       * travelling for nothing.
       */
      const next = `${sphere.x.toFixed(1)},${sphere.y.toFixed(1)},${sphere.lng.toFixed(3)},${sphere.lat.toFixed(3)},${sphere.diameter.toFixed(1)}`;

      if (heavy && next !== signature) {
        signature = next;

        const sun = sunRef.current;
        const highlight = sun
          ? sunOnSphere(map, { longitude: sun.longitude, latitude: sun.declination }, sphere)
          : null;

        /*
         * Faded out rather than parked at an edge.
         *
         * Two of the four layers are gradients centred on the sun. When the
         * sun is behind the planet there is no such point on the disc, and a
         * gradient anchored just off it is a directional ramp across a world
         * that is simply in darkness - so they are turned off instead, and
         * the position is left where it was so nothing slides on the way out.
         */
        write('--globe-sun-lit', highlight ? '1' : '0');

        if (highlight) {
          write('--globe-sun-x', `${highlight.x.toFixed(1)}%`);
          write('--globe-sun-y', `${highlight.y.toFixed(1)}%`);
        }

        for (const entry of drawn) {
          const { run, glow, line, dest } = entry;
          const arc = projectArc(map, run, sphere);

          if (!arc) {
            arcs.delete(run.key);
            glow.removeAttribute('d');
            line.removeAttribute('d');
            dest.halo.setAttribute('visibility', 'hidden');
            dest.core.setAttribute('visibility', 'hidden');
            continue;
          }

          arcs.set(run.key, arc);
          glow.setAttribute('d', arc.d);
          line.setAttribute('d', arc.d);

          const last = arc.points[arc.points.length - 1]!;
          for (const circle of [dest.halo, dest.core]) {
            circle.setAttribute('cx', last.x.toFixed(1));
            circle.setAttribute('cy', last.y.toFixed(1));
            circle.setAttribute('visibility', arc.endVisible ? 'visible' : 'hidden');
          }
        }

        /*
         * Which six: the best-ranked of the routes whose far end is on the
         * near side. A route that turns away is replaced by the next one
         * round, rather than the globe thinning out as it turns.
         */
        const shown = drawn
          .filter((entry) => (arcs.get(entry.run.key)?.fade ?? 0) > 0)
          .sort((a, b) => a.run.rank - b.run.rank)
          .slice(0, MAX_ARCS);

        for (const entry of drawn) entry.allowed = shown.includes(entry);
        for (const [index, entry] of shown.entries()) startDraw(entry, index, now);

        // The shared home node, on whichever shown arc leaves the planet's face.
        const lead = shown.find((entry) => arcs.get(entry.run.key)?.startVisible);
        const leadArc = lead ? arcs.get(lead.run.key) : undefined;
        for (const circle of [home.halo, home.core]) {
          if (leadArc) {
            circle.setAttribute('cx', leadArc.points[0]!.x.toFixed(1));
            circle.setAttribute('cy', leadArc.points[0]!.y.toFixed(1));
          }
          circle.setAttribute('visibility', leadArc ? 'visible' : 'hidden');
        }
      }

      /*
       * Each arc's opacity, every frame.
       *
       * Heading for 1 - or 0 when another destination is the selected one -
       * at the speed that takes 220ms, and multiplied by how squarely its far
       * end faces us, so a route to the other side of the planet fades out
       * instead of stopping at the limb. Written only when it changes.
       */
      const seconds = Math.min(0.1, (now - previousFrame) / 1000);
      previousFrame = now;

      for (const entry of drawn) {
        const target = entry.allowed
          ? arcTargetOpacity(keys, entry.run.key, focusedRef.current)
          : 0;
        entry.shown = moving
          ? entry.shown +
            Math.sign(target - entry.shown) *
              Math.min(Math.abs(target - entry.shown), (seconds * 1000) / ARC_FADE_MS)
          : target;

        const opacity =
          entry.drawnAt === null ? 0 : entry.shown * (arcs.get(entry.run.key)?.fade ?? 0);
        const rounded = Math.round(opacity * 100) / 100;
        if (rounded !== entry.written) {
          entry.written = rounded;
          entry.group.setAttribute('opacity', String(rounded));
        }
      }

      if (!moving) return;

      // The travelling light is decoration: it stands down with the hero.
      const looking = visibleRef.current;

      for (const [index, entry] of drawn.entries()) {
        const { run, light } = entry;
        if (!light) continue;

        const arc = arcs.get(run.key);
        const sinceDrawn = entry.drawnAt === null ? -1 : now - entry.drawnAt - ARC_DRAW_MS;
        const fraction = sinceDrawn < 0 || !looking ? null : arcLightFraction(sinceDrawn, index);
        const at = arc && fraction !== null ? pointAt(arc, fraction) : null;

        if (!at || fraction === null) {
          light.setAttribute('fill-opacity', '0');
          light.setAttribute('stroke-opacity', '0');
          continue;
        }

        const fade = arcLightOpacity(fraction);
        light.setAttribute('cx', at.x.toFixed(1));
        light.setAttribute('cy', at.y.toFixed(1));
        light.setAttribute('fill-opacity', (0.95 * fade).toFixed(2));
        light.setAttribute('stroke-opacity', (0.35 * fade).toFixed(2));
      }
    };

    /*
     * A beat before any of this starts.
     *
     * The same rule the weather follows. Measuring the silhouette and
     * projecting three hundred points is the heaviest thing on this page
     * after the map itself, and starting it the instant the globe is ready
     * puts it on the main thread alongside the hydration of every link on the
     * page. On a machine running several of these at once that showed up as
     * lens links that did not navigate, because they had not been hydrated
     * yet. Decoration waits.
     */
    const begin = window.setTimeout(() => {
      frame = window.requestAnimationFrame(step);
    }, 800);

    /*
     * Re-projected in the frame the map moved in.
     *
     * Dragging used to look like the strings trailing the planet because they
     * were redone on a 40ms timer, a frame or two behind the canvas. MapLibre's
     * `render` fires as each frame is drawn, and this runs synchronously inside
     * it, so the SVG and the canvas are updated in the same task and painted
     * together. The animation loop above still runs for the lights, and skips
     * a frame this has already done.
     */
    const onRender = () => {
      if (document.hidden) return;
      try {
        draw(performance.now());
      } catch {
        // A dropped frame, as in `step`.
      }
    };
    map.on('render', onRender);

    return () => {
      window.clearTimeout(begin);
      window.cancelAnimationFrame(frame);
      map.off('render', onRender);
      for (const { group } of drawn) group.remove();
      home.halo.remove();
      home.core.remove();
    };
  }, [routes, status, projection]);

  /* ------------------------------------------------------------------ */
  /* Globe or flat map.                                                  */
  /* ------------------------------------------------------------------ */
  React.useEffect(() => {
    const map = mapRef.current;
    if (!map || status !== 'ready') return;

    map.setProjection({ type: projection });

    /*
     * The night is a thing about a ball.
     *
     * A cap around the dark pole is the correct shape on a sphere and a
     * parabola three screens wide once it is unrolled onto a Mercator map,
     * with a bright rim traced along it - which reads as a shape somebody
     * drew rather than as sunlight. The flat map keeps the city lights,
     * which fade with the sun's own elevation and say the same thing without
     * a drawn edge anywhere.
     */
    const globe = projection === 'globe';

    /*
     * Every cap of the swept night, plus the line that rounds it off.
     *
     * The night is drawn as `DUSK_STEPS` overlapping caps rather than one
     * polygon, so switching it off means switching all of them off. The ids
     * are built from the same constant the layers are, because the hard
     * coded pair this replaces had silently stopped matching: `getLayer`
     * found nothing, the loop did nothing, and the cap stayed on over the
     * flat map where it is the wrong shape entirely.
     */
    const nightLayers = Array.from(
      { length: DUSK_STEPS },
      (_unused, depth) => [`night-${depth}`, 'fill-opacity', DUSK_STEP_ALPHA] as const,
    );

    for (const [layer, property, on] of [
      ...nightLayers,
      ['twilight-shade', 'line-opacity', 0.34] as const,
    ]) {
      if (map.getLayer(layer)) map.setPaintProperty(layer, property, globe ? on : 0);
    }

    /*
     * A flat map is not a globe at a different angle.
     *
     * The opening zoom is the one that fits a sphere to the box, and at that
     * zoom a Mercator world is a stripe across the middle of it. So the view
     * is refitted on the way in each direction rather than left where the
     * other projection had put it.
     */
    if (!globe) {
      // The Mercator world is 512px wide at zoom zero, so this is the zoom
      // that makes it exactly as wide as the box it is drawn in.
      const width = map.getContainer().clientWidth;
      map.easeTo({
        center: [16, 24],
        zoom: Math.max(0, Math.log2(Math.max(width, 1) / 512)),
        duration: prefersReducedMotion() ? 0 : 600,
      });
    } else if (!selectedCountry) {
      map.easeTo({
        ...overview(map.getContainer(), origins, chips, stage, seasonDate),
        pitch: 0,
        duration: prefersReducedMotion() ? 0 : 600,
      });
    }
    // The view is refitted on a change of projection only; a later selection
    // has its own flight, and refitting here would fight with it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projection, status]);

  /* ------------------------------------------------------------------ */
  /* Data updates, in place.                                             */
  /* ------------------------------------------------------------------ */
  /*
   * A place with a price wears a pin; every other place is a dim dot.
   *
   * The dots are a MapLibre circle layer, which costs paint and no DOM, so
   * hundreds of them are free. A destination that has a pin is taken out of
   * the dots so the two are never drawn on top of each other.
   */
  React.useEffect(() => {
    const map = mapRef.current;
    if (!map || status !== 'ready' || !map.getLayer('airport-dots')) return;

    map.setFilter('airport-dots', [
      'all',
      ['==', ['get', 'kind'], 'airport'],
      ['!', ['in', ['get', 'iata'], ['literal', chips.map((chip) => chip.destination)]]],
    ] as never);
  }, [chips, status]);

  /*
   * A new home airport eases the camera to it; it never snaps.
   *
   * Changing where you are leaving from used to leave the planet looking at
   * the old airport until something else moved it. Not on the first view, and
   * not while a country or a pin owns the camera.
   */
  const homeCode = origins[0]?.code ?? null;
  const previousHome = React.useRef<string | null>(null);
  React.useEffect(() => {
    const map = mapRef.current;
    if (!map || status !== 'ready') return;

    if (
      previousHome.current !== null &&
      previousHome.current !== homeCode &&
      !selectedCountry &&
      !flownRef.current
    ) {
      map.easeTo({
        ...overview(map.getContainer(), origins, chips, stage, seasonDate),
        duration: prefersReducedMotion() ? 0 : 1200,
        easing: EASE_OUT_EXPO,
      });
    }
    previousHome.current = homeCode;
    // Only a change of airport moves the camera; the rest is read when it does.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [homeCode, status]);

  /*
   * The page changed under the globe: hero composition to explorer, or back.
   *
   * The box it fills has already moved (the host animates that), so the
   * camera follows it on the same curve rather than snapping to the new fit:
   * the zoom, the centre and the padding that offsets the planet to the right
   * of the headline all ease together. A selected country or a destination
   * the rail pointed at owns the camera, so those are left alone.
   */
  React.useEffect(() => {
    const map = mapRef.current;
    if (!map || status !== 'ready') return;
    if (previousVariant.current === variant) return;
    previousVariant.current = variant;

    if (variant === 'explorer') map.scrollZoom.enable();
    else map.scrollZoom.disable();

    // The canvas is still the old size until the observer fires next frame.
    map.resize();
    geometryRef.current();

    const padding =
      variant === 'stage' ? stagePadding(window.innerWidth) : explorerPadding(map.getContainer());

    if (selectedCountry || flownRef.current || projectionRef.current !== 'globe') {
      map.setPadding(padding);
      return;
    }

    reframingRef.current = true;
    const fit = overview(map.getContainer(), origins, chips, stage, seasonDate);
    map.once('moveend', () => {
      reframingRef.current = false;
      restingZoomRef.current = map.getZoom();
      layoutRef.current();
    });
    map.easeTo({
      ...fit,
      padding,
      pitch: 0,
      duration: prefersReducedMotion() ? 0 : REFRAME_MS,
      easing: EASE_OUT_EXPO,
    });
    // Only a change of variant reframes; the rest is read when it does.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [variant, status]);

  React.useEffect(() => {
    const map = mapRef.current;
    if (!map || status !== 'ready') return;

    (map.getSource('routes') as GeoJSONSource | undefined)?.setData(routes as never);
    (map.getSource('destinations') as GeoJSONSource | undefined)?.setData(points as never);
    (map.getSource('origins') as GeoJSONSource | undefined)?.setData({
      type: 'FeatureCollection',
      features: origins.map((origin) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [...origin.position] },
        properties: { code: origin.code, name: origin.name },
      })),
    });
  }, [routes, points, origins, status]);

  /*
   * Country names, once the globe is close enough to be asking for them.
   *
   * Nothing at globe zoom, for the same reason the borders are nothing
   * there: a hundred and seventy-seven names across a whole planet is an
   * atlas, and what the front page shows is a place. Past `NAME_ZOOM` the
   * question has changed to "which country is this", and then a name is the
   * quickest possible answer.
   *
   * **Drawn as markers, not as map labels.** MapLibre renders text from
   * glyph files served by a glyph endpoint; there is none here and there is
   * not going to be one, because the globe reaches no origin but ours and a
   * test asserts it. A marker is a DOM element, so it uses the page's own
   * self-hosted font, inherits the page's colours, and gets occlusion behind
   * the sphere for free from `opacityWhenCovered`.
   *
   * They are `aria-hidden`: the canvas is decoration, and every country on
   * it is already reachable as a link or a card in the DOM.
   */
  React.useEffect(() => {
    const map = mapRef.current;
    if (!map || status !== 'ready') return;

    /** Below this the globe is a planet; above it, a map of countries. */
    const NAME_ZOOM = 3.2;

    /** Capitals once the countries are named, airports once they are close. */
    const CAPITAL_ZOOM = 3.8;
    const NAME_CITIES = false as boolean;
    const AIRPORT_ZOOM = 4.6;

    /**
     * How many of each rank, at most.
     *
     * A budget per kind rather than one shared cap. Shared, the sort put the
     * highest-ranked places first and every slot left after the countries
     * went to airports - Natural Earth scores a major airport above almost
     * any capital - so the capitals never appeared at all. Three separate
     * allowances mean each rank is thinned against its own kind.
     */
    const MOST: Record<'country' | 'capital' | 'airport', number> = {
      country: 12,
      capital: 10,
      airport: 10,
    };

    let cancelled = false;
    let cleanup: (() => void) | null = null;
    const labels = new Map<string, Marker>();
    const seenRank = new Map<string, number>();

    void (async () => {
      const maplibre = await import('maplibre-gl');
      if (cancelled) return;

      const clear = () => {
        for (const marker of labels.values()) marker.remove();
        labels.clear();
      };

      /*
       * What the last pass was computed for.
       *
       * `idle` fires whenever the map has finished drawing, and the stage
       * keeps it drawing - the arcs and the travelling lights never stop - so
       * this ran about two hundred times for one zoom, walking every feature
       * of the world file each time. The centre and the zoom are the whole of
       * what decides which names belong on screen, so a signature of the two
       * says whether there is anything to redo.
       */
      let signature = '';

      const sync = () => {
        if (!map.isStyleLoaded() || !map.getLayer('countries') || map.getZoom() < NAME_ZOOM) {
          signature = '';
          clear();
          return;
        }

        /*
         * Nothing is recorded until the data is actually there.
         *
         * `querySourceFeatures` reads loaded tiles, so a pass that runs
         * before the source has any returns an empty world. Without this the
         * signature would record that empty answer as done for this view and
         * never look again, and the names simply never appeared - which is
         * what happened the moment the pass stopped running every frame.
         */
        if (!map.isSourceLoaded('world')) return;

        const centre = map.getCenter();
        const next = `${centre.lng.toFixed(3)},${centre.lat.toFixed(3)},${map.getZoom().toFixed(3)}`;

        if (next === signature) return;
        signature = next;

        /*
         * Read off the source, not off what was rendered.
         *
         * `queryRenderedFeatures` was the obvious call and it returns
         * nothing here: the only layer that knows which country a pixel
         * belongs to is the hit layer, and that is painted at zero opacity,
         * which the renderer takes as nothing drawn and so nothing to
         * report. `querySourceFeatures` reads the loaded data instead, which
         * is what is actually wanted - the countries whose box overlaps the
         * view, whether or not any of them is currently being painted.
         */
        const seen = new Map<
          string,
          {
            name: string;
            kind: 'country' | 'capital' | 'airport';
            area: number;
            centre: [number, number];
          }
        >();

        /*
         * Inset from the edges, so a clamped label is never half off screen
         * or under the zoom controls in the corner.
         */
        const bounds = map.getBounds();
        const inset = (bounds.getNorth() - bounds.getSouth()) * 0.12;

        const view = {
          west: bounds.getWest() + inset,
          east: bounds.getEast() - inset,
          south: bounds.getSouth() + inset,
          north: bounds.getNorth() - inset,
        };

        for (const feature of map.querySourceFeatures('world')) {
          const adm0 = feature.properties?.adm0;
          const name = feature.properties?.shortName ?? feature.properties?.name;
          if (typeof adm0 !== 'string' || typeof name !== 'string' || seen.has(adm0)) continue;

          const raw = feature.properties?.bbox;
          const box: unknown = typeof raw === 'string' ? JSON.parse(raw) : raw;
          if (!Array.isArray(box) || box.length < 4) continue;

          const edges = box as number[];
          if (!edges.slice(0, 4).every((value) => Number.isFinite(value))) continue;

          const [west = 0, south = 0, east = 0, north = 0] = edges;

          // Off screen entirely: no label, and no slot used up by one.
          if (east < view.west || west > view.east || north < view.south || south > view.north) {
            continue;
          }

          /*
           * The middle of what is on screen, not the middle of the country.
           *
           * A label parked at the centre of a country's box leaves the
           * viewport as soon as the view is closer than the whole country -
           * so zooming into northern Spain put "Spain" somewhere off past
           * Madrid, and the names simply vanished at exactly the zoom they
           * were added for. Clamping the point into the visible bounds keeps
           * the name over the part being looked at, which is how a paper map
           * has always done it.
           */
          seen.set(adm0, {
            name,
            kind: 'country',
            area: (east - west) * (north - south),
            centre: [
              Math.min(Math.max((west + east) / 2, view.west), view.east),
              Math.min(Math.max((south + north) / 2, view.south), view.north),
            ],
          });
        }

        /*
         * Capitals, then the airports, once there is room for them.
         *
         * A country name says where you are; a capital says it more exactly,
         * and an airport is the thing a trip can actually be pointed at - so
         * they arrive in that order as the view closes in, each one only once
         * the last has stopped being enough.
         */
        /*
         * Off: cities are named by the label pass now, from the view, with
         * their own link. A second, unlinked capital name beside a city label
         * was the same word twice.
         */
        if (NAME_CITIES && map.getZoom() >= CAPITAL_ZOOM) {
          const airports = map.getZoom() >= AIRPORT_ZOOM;

          for (const feature of map.querySourceFeatures('places')) {
            const kind = feature.properties?.kind;
            const name = feature.properties?.name;
            if (typeof name !== 'string') continue;
            if (kind !== 'capital' && !(kind === 'airport' && airports)) continue;

            const at = feature.geometry;
            if (at?.type !== 'Point') continue;

            const [longitude = 0, latitude = 0] = at.coordinates;
            if (
              longitude < view.west ||
              longitude > view.east ||
              latitude < view.south ||
              latitude > view.north
            ) {
              continue;
            }

            // Keyed by kind as well as name, so a capital and an airport that
            // share one do not fight over the same marker.
            seen.set(`${kind}:${name}`, {
              name: kind === 'airport' ? (feature.properties?.iata ?? name) : name,
              kind: kind === 'airport' ? 'airport' : 'capital',
              // Ranked under every country, so a name is never crowded out by
              // an airport, and above nothing else.
              area: -1 - (10 - (Number(feature.properties?.rank) || 0)) / 100,
              centre: [longitude, latitude],
            });
          }
        }

        /*
         * The most prominent of each kind, then stop.
         *
         * Every sliver of a neighbour clipping the corner of the view is a
         * country in this list, and naming all of them turns the map into a
         * word search. Ordering by how much of the world each one covers
         * means the names that appear are the ones being looked at.
         */
        const budget = { ...MOST };
        const keep = new Set<string>();

        for (const [key, place] of [...seen.entries()].sort((a, b) => b[1].area - a[1].area)) {
          if (budget[place.kind] <= 0) continue;

          budget[place.kind] -= 1;
          keep.add(key);
        }

        for (const key of [...seen.keys()]) {
          if (!keep.has(key)) seen.delete(key);
        }

        seenRank.clear();
        for (const [key, place] of seen) seenRank.set(key, place.area);

        for (const [adm0, marker] of labels) {
          if (!seen.has(adm0)) {
            marker.remove();
            labels.delete(adm0);
          }
        }

        for (const [adm0, { name, kind, centre }] of seen) {
          const existing = labels.get(adm0);

          if (existing) {
            existing.setLngLat(centre);
            continue;
          }

          const element = document.createElement('span');
          element.className = `voyagr-place-name voyagr-place-${kind}`;
          element.setAttribute('aria-hidden', 'true');
          element.textContent = name;

          labels.set(
            adm0,
            new maplibre.Marker({ element, opacityWhenCovered: 0 }).setLngLat(centre).addTo(map),
          );
        }

        thin();
      };

      /**
       * Names must not pile up.
       *
       * The same pass the price chips get, for the same reason: a country, its
       * capital and that capital's airport are three labels within a few
       * pixels of each other, and drawn all at once they are illegible -
       * IRAQ over Baghdad over BGW. Laid out in rank order, anything that
       * would land on a name already placed is hidden instead.
       *
       * Measured in a frame of its own, because MapLibre positions a marker
       * by transform and the rectangle is not final until it has painted.
       */
      let pending = false;

      const thin = () => {
        if (pending) return;
        pending = true;

        window.requestAnimationFrame(() => {
          pending = false;

          const ordered = [...labels.entries()].sort(
            (a, b) => (seenRank.get(b[0]) ?? 0) - (seenRank.get(a[0]) ?? 0),
          );

          /*
           * Seeded with everything already drawn over the globe.
           *
           * The price chips are laid out by their own pass and the panels are
           * fixed in the markup; neither knows about these names, so a name
           * would happily land under a price and be unreadable - which is
           * exactly what happened to Doha under the Dubai chip. Reading their
           * boxes first means a name that would collide is dropped and the
           * space goes to one that fits.
           */
          const placed: DOMRect[] = [
            ...document.querySelectorAll('[data-globe-overlay]'),
            ...document.querySelectorAll('.voyagr-chip-host, .voyagr-label-host'),
          ]
            .map((node) => node.getBoundingClientRect())
            .filter((rect) => rect.width > 0);

          for (const [, marker] of ordered) {
            const element = marker.getElement();
            element.classList.remove('voyagr-place-hidden');

            const rect = element.getBoundingClientRect();
            if (rect.width === 0) continue;

            const collides = placed.some(
              (other) =>
                rect.left < other.right + 6 &&
                rect.right > other.left - 6 &&
                rect.top < other.bottom + 2 &&
                rect.bottom > other.top - 2,
            );

            if (collides) element.classList.add('voyagr-place-hidden');
            else placed.push(rect);
          }
        });
      };

      map.on('moveend', sync);
      map.on('zoomend', sync);
      map.on('idle', sync);
      sync();

      cleanup = () => {
        map.off('moveend', sync);
        map.off('zoomend', sync);
        map.off('idle', sync);
        clear();
      };
    })();

    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, [status]);

  /*
   * Markers: one host element per chip, rendered into by React below.
   *
   * A pin that is no longer wanted does not vanish: it keeps its marker and
   * its content for 220ms while it fades out (`data-leaving`), and a new pin
   * fades in on its own entrance. A pin that comes back during its fade is
   * simply kept.
   */
  const previousChips = React.useRef<readonly StageChip[]>([]);
  const leavingTimers = React.useRef(new Map<string, number>());
  const [leaving, setLeaving] = React.useState<Readonly<Record<string, StageChip>>>({});

  React.useEffect(() => {
    const map = mapRef.current;
    if (!map || status !== 'ready') return;

    let cancelled = false;

    void (async () => {
      const maplibre = await import('maplibre-gl');
      if (cancelled) return;

      const wanted = new Set(chips.map((chip) => chip.destination));
      const departed = previousChips.current.filter(
        (chip) => !wanted.has(chip.destination) && markersRef.current.has(chip.destination),
      );
      previousChips.current = chips;

      // Back before its fade finished: keep it.
      for (const code of wanted) {
        const timer = leavingTimers.current.get(code);
        if (timer !== undefined) {
          window.clearTimeout(timer);
          leavingTimers.current.delete(code);
          markersRef.current.get(code)?.getElement().removeAttribute('data-leaving');
        }
      }

      if (departed.length > 0) {
        setLeaving((current) => {
          const next = { ...current };
          for (const chip of departed) next[chip.destination] = chip;
          return next;
        });
      }

      for (const chip of departed) {
        const code = chip.destination;
        if (leavingTimers.current.has(code)) continue;

        const marker = markersRef.current.get(code);
        marker?.getElement().setAttribute('data-leaving', 'true');

        const timer = window.setTimeout(
          () => {
            leavingTimers.current.delete(code);
            const gone = markersRef.current.get(code);
            gone?.remove();
            markersRef.current.delete(code);
            setLeaving((current) => {
              const next = { ...current };
              delete next[code];
              return next;
            });
            setHosts((current) => {
              const next = { ...current };
              delete next[code];
              return next;
            });
          },
          prefersReducedMotion() ? 0 : PIN_LEAVE_MS,
        );
        leavingTimers.current.set(code, timer);
      }

      for (const chip of chips) {
        let marker = markersRef.current.get(chip.destination);

        if (!marker) {
          const host = document.createElement('div');
          host.className = 'voyagr-chip-host';
          marker = new maplibre.Marker({
            element: host,
            anchor: 'left',
            // The chip now carries its own marker dot as its first element,
            // so the anchor is pulled back by half that dot: what lands on
            // the coordinate is the dot, not the edge of the label.
            offset: [-5, 0],
            // Fully hidden on the far side, with the class the stylesheet
            // turns into `visibility: hidden` so the link leaves the tab order.
            opacityWhenCovered: 0,
          })
            .setLngLat([chip.position[0], chip.position[1]])
            .addTo(map);
          markersRef.current.set(chip.destination, marker);
        } else {
          marker.setLngLat([chip.position[0], chip.position[1]]);
        }
      }

      // Every live marker, the ones fading out included.
      const next: Record<string, HTMLElement> = {};
      for (const [code, marker] of markersRef.current) next[code] = marker.getElement();
      setHosts(next);
    })();

    return () => {
      cancelled = true;
    };
  }, [chips, status]);

  // Timers outlive a render, not the component.
  React.useEffect(() => {
    const timers = leavingTimers.current;
    return () => {
      for (const timer of timers.values()) window.clearTimeout(timer);
      timers.clear();
    };
  }, []);

  /*
   * The accent follows the globe.
   *
   * Written onto the document rather than passed down, because what it
   * changes is a handful of custom properties that everything on the stage
   * already reads through the cascade. Cleared on unmount, so a page without
   * a globe is never left wearing the last one's colours.
   */
  React.useEffect(() => {
    if (!biome) return;

    document.documentElement.dataset.biome = biome;
    return () => {
      delete document.documentElement.dataset.biome;
    };
  }, [biome]);

  /* After the chips have rendered into their hosts, measure them again and lay them out. */
  React.useEffect(() => {
    chipSizesRef.current.clear();
    geometryRef.current();
    layoutRef.current();
  }, [hosts, chips]);

  /*
   * Pins keep clear of whatever is laid over the globe, even when it changes.
   *
   * The collision pass runs as the globe moves, and the globe holds still
   * while somebody is typing in the search - so a search that opens, and
   * pushes the headline up under a price, would never be re-measured. The
   * overlays are watched for a change of size and the pass is run again.
   */
  React.useEffect(() => {
    const root = rootRef.current;
    if (!root || status !== 'ready' || typeof ResizeObserver === 'undefined') return;

    // The overlays belong to whichever page is showing, so this is re-read
    // whenever the page (and with it the variant) changes.
    const observer = new ResizeObserver(() => {
      geometryRef.current();
      layoutRef.current();
    });
    for (const overlay of document.querySelectorAll('[data-globe-overlay]')) {
      observer.observe(overlay);
    }

    return () => observer.disconnect();
  }, [status, variant, chips]);

  /*
   * The rail points at a pin.
   *
   * Focusing (or lingering on) a destination in the rail flies the camera to
   * it: 1400ms on the expo curve, 0.6 closer, tilted 18 degrees. Leaving the
   * rail brings it back in 900ms. While it is parked there the idle turn
   * stands down. A country that is open owns the camera, so this does nothing
   * then, and nothing in the flat map, where there is no globe to turn.
   */
  React.useEffect(() => {
    const map = mapRef.current;
    if (!map || status !== 'ready') return;

    const onFocus = (event: Event) => {
      const code = (event as CustomEvent<{ code?: string }>).detail?.code;
      const chip = latest.current.chips.find((candidate) => candidate.destination === code);
      if (!chip || latest.current.selectedCountry || projectionRef.current !== 'globe') return;

      flownRef.current = true;
      focusedRef.current = code ?? null;
      const resting = overview(
        map.getContainer(),
        origins,
        latest.current.chips,
        stage,
        seasonDate,
      );

      map.easeTo({
        center: [chip.position[0], chip.position[1]],
        zoom: resting.zoom + FLY_ZOOM,
        pitch: FLY_PITCH,
        duration: prefersReducedMotion() ? 0 : FLY_MS,
        easing: EASE_OUT_EXPO,
      });
    };

    const onRelease = () => {
      if (!flownRef.current) return;
      flownRef.current = false;
      focusedRef.current = null;
      map.easeTo(
        returnTo(overview(map.getContainer(), origins, latest.current.chips, stage, seasonDate)),
      );
    };

    window.addEventListener(GLOBE_FOCUS_EVENT, onFocus);
    window.addEventListener(GLOBE_RELEASE_EVENT, onRelease);

    return () => {
      window.removeEventListener(GLOBE_FOCUS_EVENT, onFocus);
      window.removeEventListener(GLOBE_RELEASE_EVENT, onRelease);
    };
  }, [status, origins, stage, seasonDate]);

  /*
   * A pin whose price changed since you last looked pulses once.
   *
   * What was last seen is kept in this browser's local storage - prices as the
   * server formatted them, nothing about the traveller. A first visit has
   * nothing to compare against, so nothing pulses. The pulse is a one-shot
   * class, cleared after a second: no pin pulses for ever.
   */
  React.useEffect(() => {
    // The chips render into their markers a beat after `hosts` is set.
    if (status !== 'ready' || comparedRef.current || Object.keys(hosts).length === 0) return;
    comparedRef.current = true;

    let seen: Record<string, string> | null = null;
    try {
      const raw = window.localStorage.getItem(PIN_PRICES_KEY);
      const parsed: unknown = raw ? JSON.parse(raw) : null;
      seen = parsed && typeof parsed === 'object' ? (parsed as Record<string, string>) : null;
    } catch {
      seen = null;
    }

    const changed = changedPins(seen, chips);

    try {
      const next: Record<string, string> = { ...seen };
      for (const chip of chips) if (chip.label) next[chip.destination] = chip.label;
      window.localStorage.setItem(PIN_PRICES_KEY, JSON.stringify(next));
    } catch {
      // Private mode or a full quota: the pulse is a nicety, not a feature.
    }

    if (changed.length === 0) return;

    // Straight onto the element: a one-shot attribute, not render state.
    const frame = window.requestAnimationFrame(() => {
      for (const code of changed) {
        const pin = document.querySelector(`.voyagr-chip[data-destination="${CSS.escape(code)}"]`);
        pin?.setAttribute('data-pulse', 'true');
        window.setTimeout(() => pin?.removeAttribute('data-pulse'), 1000);
      }
    });

    return () => window.cancelAnimationFrame(frame);
  }, [chips, status, hosts]);

  /* Selection: feature state and a flight, in place. */
  React.useEffect(() => {
    const map = mapRef.current;
    if (!map || status !== 'ready') return;

    const previous = selectedRef.current;
    const nextKey = selectedCountry?.adm0 ?? null;

    if (previous && previous !== nextKey) {
      countryStateRef.current(previous, { selected: false });
    }

    if (selectedCountry) {
      countryStateRef.current(selectedCountry.adm0, { selected: true });

      if (previous !== nextKey) {
        const [w, s, e, n] = selectedCountry.bbox;
        map.fitBounds(
          [
            [w!, s!],
            [e!, n!],
          ],
          flightTo(map),
        );
      }
    } else if (previous) {
      map.easeTo(returnTo(overview(map.getContainer(), origins, chips, stage, seasonDate)));
    }

    selectedRef.current = nextKey;
  }, [selectedCountry, status, chips, origins, stage, seasonDate]);

  /*
   * The states and provinces of the open country.
   *
   * Added when a country is opened and removed when it is closed, because the
   * whole world's admin-1 boundaries are four megabytes and nobody browsing a
   * globe asked for them. The outlines are all this layer is: Natural Earth
   * gives a region a name and a code, and the product knows nothing else
   * about one. Filling them with colour would be a claim about places we have
   * not priced.
   */
  React.useEffect(() => {
    const map = mapRef.current;
    if (!map || status !== 'ready') return;

    const colors = stageColors();

    const apply = () => {
      const existing = map.getSource('regions') as GeoJSONSource | undefined;

      if (!regionsUrl) {
        for (const layer of ['regions'] as const) {
          if (map.getLayer(layer)) map.removeLayer(layer);
        }
        if (existing) map.removeSource('regions');
        return;
      }

      if (existing) {
        existing.setData(regionsUrl);
        return;
      }

      map.addSource('regions', { type: 'geojson', data: regionsUrl });

      map.addLayer(
        {
          id: 'regions',
          type: 'line',
          source: 'regions',
          minzoom: 2.6,
          // The file carries an outline and a label point per region; each
          // layer takes the geometry it can draw.
          filter: ['==', ['geometry-type'], 'Polygon'],
          paint: {
            'line-color': colors.border,
            'line-width': 0.6,
            // Fading in rather than appearing means the boundaries read as
            // detail arriving, not as the map changing its mind.
            'line-opacity': ['interpolate', ['linear'], ['zoom'], 2.6, 0, 3.6, 0.75],
            'line-dasharray': [2, 2],
          },
        },
        // Under the routes, so a boundary never crosses a flight path.
        'routes',
      );
    };

    /*
     * Tried at once, and polled only if MapLibre actually refuses.
     *
     * This used to wait for `map.isStyleLoaded()`, which is a stricter
     * question than the one that matters: it is false while *any* paint
     * property is pending, and the weather animation sets one every hundred
     * milliseconds for ever. A poll on a 125ms timer against a flag that
     * flickers at 100ms is a coin toss, and the side it lands on decides
     * whether an open country ever draws its regions at all.
     *
     * What `addSource` needs is only that the style has loaded, and it has:
     * `status` becomes `ready` inside the map's own `load` handler. So this
     * attempts it, and keeps the patient polling path for the case where
     * MapLibre disagrees and throws.
     */
    try {
      apply();
    } catch {
      whenStyleReady(map, apply);
    }
  }, [regionsUrl, status]);

  const clearHref = React.useMemo(() => {
    const params = new URLSearchParams(navigation.query);
    params.delete('country');
    const query = params.toString();
    return query ? `${navigation.path}?${query}` : navigation.path;
  }, [navigation]);

  const zoom = (delta: number) => {
    const map = mapRef.current;
    if (!map) return;
    map.easeTo({ zoom: map.getZoom() + delta, duration: prefersReducedMotion() ? 0 : 300 });
  };

  const recentre = () => {
    const map = mapRef.current;
    if (!map) return;
    flownRef.current = false;
    map.easeTo(returnTo(overview(map.getContainer(), origins, chips, stage, seasonDate)));
  };

  /** Every control on the globe wears the same pane of glass. */
  const controlClass =
    'voyagr-panel text-stage-ink ease-standard duration-quick grid size-10 place-items-center rounded-(--radius-control) transition-colors hover:text-(--color-stage-accent)';

  return (
    <div
      ref={rootRef}
      data-variant={variant}
      className={cn(
        /*
         * No border, no corner radius, no background - and no clipping.
         *
         * The globe is not a panel on the page, it is the page. Clipping used
         * to stay so that a chip projected off the box could not float over
         * the copy beside it, and the cost of that was the sphere and its
         * atmosphere being cut off square wherever the box ended. The chips
         * are handled where they should be - the collision pass below hides
         * any that reach past the box towards the copy - and the planet is
         * free to be cropped by the viewport instead of by a frame.
         */
        'voyagr-stage relative isolate',
        /*
          Square on a phone, and the whole column on a desktop.

          The height cap used to apply at every width, which left a band of
          empty box under the planet that nothing could be positioned
          against: a card placed at the bottom of the column landed over the
          globe's own controls rather than under them.
        */
        variant === 'hero' &&
          'aspect-square max-h-[38rem] w-full lg:aspect-auto lg:h-full lg:max-h-none',
        // The front page's box is positioned by its parent - see DiscoveryStage.
        variant === 'explorer' && 'h-full w-full',
        className,
      )}
    >
      {/*
        The sphere that is there before the map is, and stays if the map
        never loads. Pure CSS, no data on it: the data is in the rail.
      */}
      <div
        aria-hidden="true"
        className={cn(
          'pointer-events-none absolute inset-0 -z-10 flex items-center justify-center transition-opacity duration-500',
          status === 'ready' ? 'opacity-0' : 'opacity-100',
        )}
      >
        <div className="bg-stage-sea shadow-lifted aspect-square w-[72%] max-w-[36rem] rounded-full bg-[radial-gradient(circle_at_35%_30%,var(--color-stage-land-lit)_0%,var(--color-stage-sea)_45%,var(--color-stage-deep)_100%)] opacity-90" />
      </div>

      <div
        ref={container}
        className={cn(
          'voyagr-map h-full w-full transition-opacity duration-500',
          status === 'ready' ? 'opacity-100' : 'opacity-0',
        )}
      />

      {/*
        The atmosphere.

        Four circles the size of the sphere's own silhouette, written by the
        render loop above. None of them is geography and none of them can be
        a style layer, because every layer in a style is painted on the
        ground and all four of these are about the edge of the world seen
        from outside it. See the `voyagr-orb` rules in `globals.css`.

        All of them under the arcs: a flight over a planet is lit by the same
        sun, but it is not underneath its weather. Over the canvas, because
        the ball has to be shaded before anything can fly over it.
      */}
      <div aria-hidden="true" className="voyagr-orb voyagr-orb-shade z-[1]" />
      <div aria-hidden="true" className="voyagr-orb voyagr-orb-limb z-[1]" />
      <div aria-hidden="true" className="voyagr-orb voyagr-orb-sheen z-[1]" />
      <div aria-hidden="true" className="voyagr-orb voyagr-orb-air z-[1]" />
      <div aria-hidden="true" className="voyagr-orb voyagr-orb-rim z-[1]" />

      {/* Dark behind the explorer's text, once a zoomed planet can reach under it. */}
      {variant === 'explorer' ? (
        <div
          aria-hidden="true"
          className="voyagr-explore-scrim pointer-events-none absolute inset-0 z-[3]"
        />
      ) : null}

      <svg ref={arcsRef} aria-hidden="true" focusable="false" className="voyagr-arcs" />

      {/* The canvas is decoration; what it shows of the season is said here. */}
      <p aria-live="polite" className="sr-only">
        The globe shows a typical {monthName(Number(month))}.
      </p>

      {status === 'failed' ? (
        <p
          role="status"
          className="text-stage-ink-muted absolute inset-x-0 bottom-3 z-[5] text-center text-xs"
        >
          The map did not load. Every place it would show is listed below.
        </p>
      ) : null}

      {/* Zoom and recentre. Ordinary buttons, outside the canvas. */}
      {status === 'ready' ? (
        <>
          <div
            role="group"
            aria-label="Globe controls"
            data-globe-overlay
            className="stage-scope absolute top-4 right-4 z-[5] flex flex-col gap-2"
          >
            {selectedCountry ? (
              <a href={clearHref} title="Show the whole world" className={controlClass}>
                <Icon name="locate" size={1.05} />
                <span className="sr-only">Show the whole world</span>
              </a>
            ) : (
              <button type="button" onClick={recentre} title="Recentre" className={controlClass}>
                <Icon name="locate" size={1.05} />
                <span className="sr-only">Recentre the globe</span>
              </button>
            )}

            {/*
              The two zooms are one control with a rule between them, the way
              a zoom control on a map has always been. Two separate panes
              read as two unrelated buttons that happen to be adjacent.
            */}
            <div className="voyagr-panel flex flex-col overflow-hidden rounded-(--radius-control)">
              <button
                type="button"
                onClick={() => zoom(0.8)}
                className="text-stage-ink ease-standard duration-quick grid size-10 place-items-center transition-colors hover:text-(--color-stage-accent)"
              >
                <Icon name="plus" size={1.05} />
                <span className="sr-only">Zoom in</span>
              </button>
              <span aria-hidden="true" className="mx-2 h-px bg-white/15" />
              <button
                type="button"
                onClick={() => zoom(-0.8)}
                className="text-stage-ink ease-standard duration-quick grid size-10 place-items-center transition-colors hover:text-(--color-stage-accent)"
              >
                <Icon name="minus" size={1.05} />
                <span className="sr-only">Zoom out</span>
              </button>
            </div>
          </div>

          {/*
            Globe or flat map.

            A real change of projection, not a change of skin: the same
            sources, the same prices and the same links, unrolled. A globe is
            the honest shape of a planet and the wrong shape for comparing
            two places at the same latitude, and somebody reading a map
            should not have to choose between the two once and for ever.
          */}
          <div
            role="group"
            aria-label="Projection"
            data-globe-overlay
            className={cn(
              'voyagr-panel stage-scope absolute right-4 z-[5] flex gap-1 rounded-(--radius-pill) p-1',
              // The box runs below the hero on a wide screen, so the corner is
              // measured from the hero's edge, not the box's. Below that the search bar
              // is pinned to the bottom of the hero, full width, and the switch would sit
              // underneath it where nothing can reach it: so it rides above the bar.
              stage ? 'bottom-[6.5rem] lg:bottom-[calc(8%+1.5rem)]' : 'bottom-4',
            )}
          >
            {(
              [
                ['globe', 'Globe'],
                ['mercator', 'Map'],
              ] as const
            ).map(([kind, label]) => (
              <button
                key={kind}
                type="button"
                aria-pressed={projection === kind}
                onClick={() => setProjection(kind)}
                className={cn(
                  'ease-standard duration-quick rounded-(--radius-pill) px-3.5 py-1.5 text-xs font-semibold transition-colors max-lg:min-h-11 max-lg:min-w-11',
                  projection === kind ? 'voyagr-cta' : 'text-stage-ink-muted hover:text-stage-ink',
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </>
      ) : null}

      {/*
        The chips. React renders each one into the element MapLibre moves
        around, so a chip is ordinary markup - a link with a name, a figure
        and a provenance - that happens to be pinned to a place.
      */}
      {[
        ...chips,
        ...Object.values(leaving).filter(
          (gone) => !chips.some((chip) => chip.destination === gone.destination),
        ),
      ].map((chip) => {
        const host = hosts[chip.destination];
        if (!host) return null;

        return createPortal(
          <a
            key={chip.destination}
            href={chip.href}
            data-destination={chip.destination}
            data-lnglat={`${chip.position[0]},${chip.position[1]}`}
            data-highlighted={chip.highlighted ? 'true' : undefined}
            className={cn(
              // `stage-scope` so the provenance badge inside picks up the
              // glass palette; a badge drawn for a page is unreadable here.
              'voyagr-chip stage-scope stage-rise text-stage-chip-ink focus-visible:outline-stage-accent',
              'flex items-center gap-3 text-left leading-tight whitespace-nowrap',
              chip.highlighted ? 'voyagr-chip-on' : '',
            )}
            style={{ '--stage-delay': `${Math.min(chip.rank, 8) * 50}ms` } as React.CSSProperties}
          >
            {/*
              The marker itself. The reference puts a light on the place and
              the words beside it rather than a box over it, which is the
              difference between reading the planet and reading a tooltip
              layer floating above one.
            */}
            <span aria-hidden="true" className="voyagr-chip-dot" />

            <span className="flex flex-col gap-0.5">
              <span className="sr-only">{chip.actionLabel} </span>
              <span className="text-[14px] leading-tight font-semibold text-white">
                {chip.name}
              </span>
              {/*
                No price, no price line. A destination's own page knows the
                place but not what a trip there costs, and a chip carrying an
                empty figure beside a provenance badge would imply one.
              */}
              {chip.label ? (
                <span className="flex items-center gap-1.5 text-[14px] leading-tight text-white">
                  <span className="tabular-nums">{chip.label}</span>
                  {/*
                    No badge on a pin. Honesty is in the words around the
                    globe: "from" in front of every price, the line under the
                    hero, and the updated-ago line. A demo pin still says so
                    to a screen reader.
                  */}
                  {provenance === 'mock' ? <span className="sr-only"> (demo data)</span> : null}
                </span>
              ) : null}
            </span>
          </a>,
          host,
          chip.destination,
        );
      })}
    </div>
  );
}
