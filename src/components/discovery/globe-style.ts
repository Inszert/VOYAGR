import type { StyleSpecification } from 'maplibre-gl';

import { addDays, daysBetween, isIsoDate } from '@/core/dates';
import type { IsoDate } from '@/core/trip/types';
import { bySize } from '@/components/discovery/airport-size-style';
import { DUSK_STEPS, DUSK_STEP_ALPHA } from '@/discovery/terminator';

/**
 * The globe's style, built rather than written out.
 *
 * Separated from the component because it is the bulk of it and because it is
 * the part worth reading on its own: this is what the planet is made of.
 *
 * Three kinds of thing are drawn, and the distinction between them is the
 * honest one:
 *
 *  - **Permanent geography**, from Natural Earth. The land itself, the shore,
 *    and the mountain ranges, deserts and plateaus that give it its colour.
 *    The Sahara has the outline the Sahara has.
 *
 *    **Nothing here is written down.** There is no text on the sphere and no
 *    boundary on it: no country names, no peaks, no physical labels, no
 *    borders. A photograph of the Earth has none of those, and every one of
 *    them was a line or a word that said "map" louder than the planet said
 *    "planet". Which country a pixel belongs to is still known - see the
 *    `countries` layer, which is invisible until you point at it.
 *  - **A seasonal model**, from `src/discovery/seasons.ts`. Ice and snow
 *    drawn as bands of latitude, computed from the sun's position on the
 *    selected date. An inference about sunlight, not an observation, and the
 *    legend beside the globe says so.
 *  - **The product's own answer**: routes, destinations and prices, every one
 *    of which came from the search engine.
 *
 * There is no tile URL, no glyph URL and no sprite URL anywhere in here. Text
 * is rasterised from a font the machine already has - see
 * `docs/map-options.md` - which is what lets a map carry labels with no third
 * party in the render path.
 */

export interface GlobeColors {
  space: string;
  sea: string;
  seaDeep: string;
  land: string;
  landLit: string;
  landHover: string;
  border: string;
  desert: string;
  mountain: string;
  plateau: string;
  tundra: string;
  tropical: string;
  ice: string;
  snow: string;
  shelf: string;
  /** The blue the air scatters at the limb. Drawn over the canvas, not in it. */
  atmosphere: string;
  night: string;
  twilight: string;
  cityLight: string;
  cityLightDim: string;
  route: string;
  accent: string;
  origin: string;
  chip: string;
}

export interface GlobeStyleOptions {
  readonly colors: GlobeColors;
  readonly countriesUrl: string;
  /** The satellite raster, as an XYZ template on our own origin. */
  readonly earthTilesUrl?: string;
  /** The month those tiles are, `01`-`12`, which decides their paint (`earthPaint`). */
  readonly earthMonth?: string;
  /** The land itself, dissolved: continents and islands, no boundaries. */
  readonly landUrl: string;
  /** Glaciers and ice shelves. */
  readonly iceUrl: string;
  /** Capitals and major airports. */
  readonly placesUrl: string;
  readonly physicalUrl: string;
  /** Natural Earth's populated places, drawn as the lights of the night side. */
  readonly cityLightsUrl: string;
  /** The shore on its own, for the shallow water drawn along it. */
  readonly coastlineUrl: string;
  /** The night cap and the terminator, recomputed from the clock by the stage. */
  readonly sun: unknown;
  /** The sun's position, for the expression that lights each city. */
  readonly solar: {
    readonly sinDeclination: number;
    readonly cosDeclination: number;
    readonly longitude: number;
  };
  readonly routes: unknown;
  readonly points: unknown;
}

/**
 * Where the planet's surface tiles live: one pyramid per month of the year.
 *
 * The globe shows the season of the month somebody is travelling in - snow on
 * Slovakia in January, a dry brown Italy in July - from NASA's monthly Blue
 * Marble composites, built by `scripts/build-earth-texture.mjs`. It is the
 * typical look of that month, never the weather on the day.
 *
 * Versioned: the service worker keeps `/geo/` for ever, so a rebuilt set goes
 * in `v3` and this changes with it. `v1` was August only.
 */
export function earthTilesUrl(month: string): string {
  if (!/^(0[1-9]|1[0-2])$/.test(month)) {
    throw new RangeError(`earthTilesUrl() expects a two-digit month, received ${month}`);
  }

  return `/geo/earth/v2/${month}/{z}/{x}/{y}.webp`;
}

/** The month of a `YYYY-MM-DD` date, as the tiles are filed. */
export function earthMonthOf(date: string): string {
  const month = date.slice(5, 7);
  return /^(0[1-9]|1[0-2])$/.test(month) ? month : '01';
}

/**
 * The date a search form's current fields put the season on, before anybody
 * submits it - or null when the fields hold no usable date.
 *
 * The same answer the server gives once the search lands (`load-stage.ts`
 * lights the middle of the travel window): the middle of the two dates when
 * both are there and in order, the departure alone otherwise, and the chosen
 * month when the form is set to "anytime that month". Calendar arithmetic only
 * through `@/core/dates`.
 */
export function formSeasonDate(fields: {
  readonly flexibility: string | null;
  readonly departureDate: string | null;
  readonly returnDate: string | null;
  readonly monthStart: string | null;
}): IsoDate | null {
  const valid = (value: string | null): value is IsoDate => value !== null && isIsoDate(value);

  if (fields.flexibility === 'month') {
    return valid(fields.monthStart) ? fields.monthStart : null;
  }

  if (!valid(fields.departureDate)) return null;
  const from = fields.departureDate;
  if (!valid(fields.returnDate)) return from;

  const span = daysBetween(from, fields.returnDate);
  return span <= 0 ? from : addDays(from, Math.floor(span / 2));
}

/** The month a style opens on when it is not told one. */
export const EARTH_TILES_URL = earthTilesUrl('08');

/**
 * How much of the northern mid and high latitudes is snow in each month's
 * tiles, in per cent.
 *
 * Measured, not chosen: the share of pixels between 35 and 72 degrees north
 * (Greenland left out - it is ice in every month) whose darkest channel is
 * above 170 of 255, read from the zoom-2 tiles in `public/geo/earth/v2/`.
 * `globe-style.test.ts` measures the tiles again and fails if this table no
 * longer describes them, so a rebuilt set (`v3`) has to come with its own
 * numbers. The southern hemisphere is left out because its seasonal snow at
 * these latitudes rounds to nothing (under 0.1 per cent in every month).
 */
export const EARTH_SNOW_COVER: Readonly<Record<string, number>> = {
  '01': 34.7,
  '02': 36.3,
  '03': 34.1,
  '04': 28.5,
  '05': 22.2,
  '06': 5.1,
  '07': 1.1,
  '08': 1.0,
  '09': 5.0,
  '10': 18.6,
  '11': 25.7,
  '12': 33.3,
};

const SNOWIEST = Math.max(...Object.values(EARTH_SNOW_COVER));

/**
 * The photograph's paint for a month: the season step.
 *
 * The tiles already carry the season - Scandinavia averages rgb(132,151,169)
 * in January against rgb(33,52,48) in July - but the layer used to be painted
 * the same way in every month, with its whites capped at 95 per cent and a
 * light contrast, and at globe size that left January's snow a pale grey
 * that read as haze rather than winter. So the paint follows the measured
 * snow cover: the snowier the month, the more contrast and the higher the
 * white point, up to a contrast of 0.25 and a white point of 1. A summer
 * month is painted almost exactly as before (July: 0.105 and 0.952).
 *
 * No colour is added. Contrast and white point only stretch what NASA's
 * photograph already has, so the white that appears is the snow in it. The
 * step is global, because a raster cannot be painted by region: in January the
 * southern summer gets the same slight extra contrast, which darkens its
 * forests a little and leaves its colours alone.
 */
export function earthPaint(month: string): {
  readonly saturation: number;
  readonly contrast: number;
  readonly brightnessMax: number;
} {
  const cover = EARTH_SNOW_COVER[month] ?? 0;
  const winter = SNOWIEST > 0 ? Math.max(0, Math.min(1, cover / SNOWIEST)) : 0;
  const round = (value: number) => Math.round(value * 1000) / 1000;

  return {
    saturation: 0.15,
    contrast: round(0.1 + 0.15 * winter),
    brightnessMax: round(0.95 + 0.05 * winter),
  };
}

/** The raster layer that paints a month, so the stage can cross-fade between two. */
export function earthLayer(id: string, source: string, opacity = 1, month = '08') {
  const paint = earthPaint(month);

  return {
    id,
    type: 'raster' as const,
    source,
    paint: {
      'raster-saturation': paint.saturation,
      'raster-contrast': paint.contrast,
      'raster-brightness-max': paint.brightnessMax,
      'raster-fade-duration': 300,
      'raster-opacity': opacity,
    },
  };
}

/** A month's raster source. */
export function earthSource(month: string) {
  return {
    type: 'raster' as const,
    tiles: [earthTilesUrl(month)],
    tileSize: 256,
    minzoom: 0,
    maxzoom: 4,
  };
}

/**
 * The two poles, which Web Mercator cannot reach.
 *
 * The tiles stop at 85.05 degrees, and beyond that the flat fallback showed
 * through as a ring on the top of the planet. These two caps are the average
 * colour of the tile pyramid's own first and last rows - the Arctic Ocean in
 * August, and Antarctica - so they continue the photograph rather than
 * outlining where it ends.
 */
const MERCATOR_EDGE = 85.0511287798;
const POLAR_CAPS = {
  type: 'FeatureCollection' as const,
  features: [
    { colour: 'rgb(12, 35, 75)', south: false },
    { colour: 'rgb(233, 234, 235)', south: true },
  ].map(({ colour, south }) => ({
    type: 'Feature' as const,
    properties: { colour },
    geometry: {
      type: 'Polygon' as const,
      coordinates: [
        (south
          ? [
              [-180, -MERCATOR_EDGE],
              [-180, -90],
              [180, -90],
              [180, -MERCATOR_EDGE],
            ]
          : [
              [-180, MERCATOR_EDGE],
              [180, MERCATOR_EDGE],
              [180, 90],
              [-180, 90],
            ]
        ).concat([south ? [-180, -MERCATOR_EDGE] : [-180, MERCATOR_EDGE]]),
      ],
    },
  })),
};

/** A source with nothing in it yet. */
const EMPTY = { type: 'FeatureCollection' as const, features: [] };

/** Degrees to radians, for the expressions that do their own trigonometry. */
const RADIANS = Math.PI / 180;

/**
 * How high the sun is above each city, as an expression.
 *
 * The same formula as `solarElevationSine` in `src/discovery/terminator.ts`,
 * rebuilt in the style language so seven hundred points can each work out
 * their own brightness on the GPU rather than being rewritten from the main
 * thread every minute. The declination's sine and cosine are constants folded
 * in by the caller; only the sun's longitude and each point's own coordinates
 * are left for the expression to do.
 *
 * A test asserts the two agree. If they ever drift, the lights come on in
 * daylight, which is the kind of wrong that looks like a bug in the map.
 */
function solarElevation(solar: GlobeStyleOptions['solar']) {
  return [
    '+',
    ['*', solar.sinDeclination, ['sin', ['*', RADIANS, ['get', 'lat']]]],
    [
      '*',
      solar.cosDeclination,
      [
        '*',
        ['cos', ['*', RADIANS, ['get', 'lat']]],
        ['cos', ['*', RADIANS, ['-', ['get', 'lon'], solar.longitude]]],
      ],
    ],
  ];
}

/**
 * A city light's opacity, from that elevation.
 *
 * Full where the sun is a few degrees under the horizon, out by sunrise. The
 * band between the two is what gives the terminator a soft edge on the ground
 * as well as in the sky.
 */
export function cityLightOpacity(solar: GlobeStyleOptions['solar']) {
  return ['interpolate', ['linear'], solarElevation(solar), -0.12, 1, 0.02, 0];
}

/**
 * The two layers a city light is drawn as, and how bright each one is.
 *
 * Declared once because both the style and the minute timer that follows the
 * sun have to paint the same pair. They did not: the timer knew only about
 * the dots, so the bloom kept the sun's position from page load and an hour
 * later was glowing over the lit half of the planet with no lights in it.
 *
 * The bloom is deliberately faint. It is there to join a street to the next
 * street, not to put a haze over a whole country - at a third of this the
 * north of India and the Ruhr were single flat shapes.
 */
export const CITY_LIGHT_LAYERS = [
  // Brighter than the 0.3 and 0.05 this shipped with (the spec asked for +15%,
  // and a photographic night side asked for more): warm lights read against it.
  ['city-lights', 0.7],
  ['city-lights-bloom', 0.14],
] as const;

/**
 * The colour of the dusk edge: the night, with a little of the twilight in it.
 *
 * The terminator ramp is a dark line, and a dark line that is pure night reads
 * as a shadow. Warming it a few per cent towards the twilight token makes the
 * day dim into amber-brown rather than into grey. It stays a dark colour at a
 * low opacity - a warm *bright* line here was tried and drew a seam across the
 * planet, so this only tints. Falls back to the night colour if either input is
 * not one it can read.
 */
export function warmEdge(night: string, twilight: string, amount = 0.14): string {
  const read = (value: string): [number, number, number] | null => {
    const hex = /^#([0-9a-f]{6})$/i.exec(value.trim());
    if (hex) {
      const n = parseInt(hex[1]!, 16);
      return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    }

    const rgb = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/i.exec(value.trim());
    return rgb ? [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])] : null;
  };

  const a = read(night);
  const b = read(twilight);
  if (!a || !b) return night;

  const mixed = a.map((channel, index) => Math.round(channel + (b[index]! - channel) * amount));
  return `rgb(${mixed[0]}, ${mixed[1]}, ${mixed[2]})`;
}

/** One light layer's opacity: its own share, scaled by brightness and by the sun. */
export function cityLightPaint(factor: number, solar: GlobeStyleOptions['solar']) {
  return ['*', ['*', factor, ['get', 'i']], cityLightOpacity(solar)];
}

/**
 * A light's colour, from how bright it is.
 *
 * Dim lights are the deep amber of sodium seen through a lot of atmosphere;
 * the brightest cores go pale and warm. One expression, used by both circle
 * layers so the dot and its bloom can never disagree.
 */
function lightColour(colors: GlobeColors) {
  return ['interpolate', ['linear'], ['get', 'i'], 0, colors.cityLightDim, 1, colors.cityLight];
}

/** How many distinct positions the marching route dash can take. */
export const ROUTE_DASH_STEPS = 40;

/**
 * The route dash pattern at a moment of the animation.
 *
 * The dash walks by lengthening the gap in front of it, which is how a dash
 * array marches without the line changing length: `[phase, 3, 5 - phase]`
 * always sums to 8.
 *
 * **Quantised, on purpose.** MapLibre rasterises every distinct dash array it
 * is given into a fixed-size line atlas and never evicts one. A continuous
 * phase handed it a new pattern every frame, so after a few minutes of
 * animation the atlas was full ("LineAtlas out of space") and every frame
 * after that threw. Forty steps across the cycle are indistinguishable at
 * this speed and can never be more than forty entries.
 */
export function routeDashPattern(seconds: number): [number, number, number] {
  const cycle = 5;
  const step = Math.floor((((seconds * 1.6) % cycle) / cycle) * ROUTE_DASH_STEPS);
  const phase = (step / ROUTE_DASH_STEPS) * cycle;
  return [phase, 3, cycle - phase];
}

export function buildGlobeStyle(options: GlobeStyleOptions): StyleSpecification {
  const { colors } = options;

  /** One fill layer per kind of physical region, under the seasonal wash. */
  const physical = (
    [
      ['plain', colors.land, 0.35],
      ['basin', colors.plateau, 0.3],
      ['plateau', colors.plateau, 0.5],
      ['tundra', colors.tundra, 0.55],
      ['desert', colors.desert, 0.75],
      ['mountains', colors.mountain, 0.7],
    ] as const
  ).map(([kind, color, opacity]) => ({
    id: `physical-${kind}`,
    type: 'fill' as const,
    source: 'physical',
    filter: ['==', ['get', 'kind'], kind],
    paint: {
      'fill-color': color,
      // Fading in with zoom, so a globe of the whole world reads as a planet
      // rather than as a geology map, and the detail arrives as you approach.
      // Softer than it was. A country border is what somebody is choosing
      // between; a mountain range is the context it sits in, and context that
      // competes with the choice is noise.
      'fill-opacity': ['interpolate', ['linear'], ['zoom'], 0, opacity * 0.45, 3, opacity * 0.7],
    },
  }));

  /*
   * The ground itself, as a texture.
   *
   * A flat fill over the Sahara is a yellow shape; dunes running one way are a
   * desert. The pattern is generated on a canvas at runtime - see
   * `globe-textures.ts` - so this costs no file and no request.
   */
  const sand = {
    id: 'desert-texture',
    type: 'fill' as const,
    source: 'physical',
    filter: ['==', ['get', 'kind'], 'desert'],
    paint: {
      'fill-antialias': false,
      'fill-pattern': 'sand-grain',
      // Faint from orbit. Dunes running one way are what a sand sea looks
      // like from a few hundred kilometres up; from far enough out to see the
      // whole planet the same pattern is hatching drawn on a map.
      'fill-opacity': ['interpolate', ['linear'], ['zoom'], 0, 0.12, 2, 0.42, 3, 0.75],
    },
  };

  return {
    version: 8,
    projection: { type: 'globe' },
    sky: {
      /*
       * Transparent, so there is no box.
       *
       * Whatever colour the sky is painted, it is painted across the whole
       * canvas - and the canvas is a rectangle sitting on a page that has a
       * gradient behind it. Any colour at all therefore reads as the planet
       * being in a window. Transparent lets the page show through and leaves
       * the sphere floating on it, which is the whole point of the stage.
       */
      /*
       * Transparent, and the *page's* colour while it is.
       *
       * It was `rgba(0, 0, 0, 0)`, and the alpha made that look safe. It was
       * not: MapLibre's globe atmosphere fades from `horizon-color` at the
       * limb out to this, and every partly-transparent step of that fade
       * carries this colour's RGB. Black at 20% over a navy page is a black
       * ring around the planet, which is what appeared - a dark disc a little
       * larger than the sphere, sitting on top of the glow behind it.
       *
       * The fix is to fade out to the colour the page already is, so the
       * halo's own falloff is invisible against what is behind it.
       */
      'sky-color': 'rgba(5, 7, 14, 0)',
      /*
       * The horizon is the colour air is, not the colour the brand is.
       *
       * It used to be the accent, which follows the planet - so the band of
       * light around the world went amber over the Sahara. Air scatters blue
       * whatever is underneath it, and the one thing on this page that must
       * not look like a decision is the sky.
       */
      'horizon-color': colors.atmosphere,
      'fog-color': colors.seaDeep,
      /*
       * Restrained, because the atmosphere is drawn over the canvas.
       *
       * MapLibre's own halo is a band at the limb with a definite width, and
       * a definite width is an edge. At full strength it combined with the
       * soft haze in `globals.css` into exactly the bright ring both were
       * meant to avoid, so this is turned down to a suggestion and the
       * edgeless version does the work.
       */
      /*
       * Off at globe zoom. Not turned down - off.
       *
       * MapLibre's globe atmosphere fades from `horizon-color` at the limb out
       * to `sky-color`, and whatever colour that is, it is a definite band of
       * a definite width painted onto the canvas. The canvas sits on a page
       * whose glow is brighter than the page's own base, so any single colour
       * chosen for the outer stop is darker than the sky somewhere - and that
       * somewhere is a black ring around the planet. Turning it down made the
       * ring fainter; only turning it off removes it.
       *
       * The rim and the halo are drawn in CSS instead, sized to the sphere's
       * own silhouette, additive, and with no edge anywhere - see
       * `.voyagr-orb-air` in `globals.css`. Restored above the zoom where the
       * globe becomes a map and there is a real horizon to haze.
       */
      'atmosphere-blend': ['interpolate', ['linear'], ['zoom'], 0, 0, 4, 0, 6, 0.25],
    },
    sources: {
      /*
       * Two files where there used to be one, and they do different jobs.
       *
       * `land` is what gets drawn: Natural Earth's dissolved land at 50m, one
       * silhouette with no internal edges. `world` is never drawn - it is the
       * country outlines, kept because a click on the globe has to resolve to
       * a country and a dissolved landmass cannot answer that.
       */
      poles: { type: 'geojson', data: POLAR_CAPS },
      earth: {
        ...earthSource('08'),
        tiles: [options.earthTilesUrl ?? EARTH_TILES_URL],
      },
      land: { type: 'geojson', data: options.landUrl },
      ice: { type: 'geojson', data: options.iceUrl },
      places: { type: 'geojson', data: options.placesUrl },
      world: { type: 'geojson', data: options.countriesUrl, promoteId: 'adm0' },
      physical: { type: 'geojson', data: options.physicalUrl },
      /*
       * Decoration arrives after the planet does.
       *
       * The shelf and the city lights are a quarter of a megabyte between
       * them, and neither is needed for the globe to be correct - one is a
       * glow along the shore and the other is a scatter of dots on the dark
       * side. Starting them empty and filling them once the map has loaded
       * means the first paint waits for the land and its shore only, which
       * is what somebody is actually waiting to see.
       */
      'city-lights': { type: 'geojson', data: EMPTY },
      coastline: { type: 'geojson', data: EMPTY },
      sun: { type: 'geojson', data: options.sun as never },
      routes: { type: 'geojson', data: options.routes as never, lineMetrics: true },
      origins: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } },
      destinations: {
        type: 'geojson',
        data: options.points as never,
        /*
         * Declared with sixteen points that will never trigger it.
         *
         * Section 12 is explicit that thousands of markers must not appear at
         * once. Clustering is a property of the source, so turning it on
         * later would mean rebuilding the layers that read it.
         */
        cluster: true,
        clusterRadius: 44,
        clusterMaxZoom: 4,
      },
    },
    layers: [
      /*
       * The ocean, and nothing behind it.
       *
       * One background layer, not two. On a globe MapLibre paints the
       * background across the sphere only, so a second one underneath it in
       * the space colour is invisible at globe zoom and a visible rectangle
       * the moment somebody zooms in far enough for the projection to fill
       * the frame - which reads as the planet sitting in a box. The space
       * around the sphere is the page behind the canvas, which is where it
       * should come from.
       */
      { id: 'sea', type: 'background', paint: { 'background-color': colors.sea } },
      /*
       * The continental shelf.
       *
       * Every photograph of the Earth has a pale band of shallow water around
       * each landmass, and its absence is most of why a vector globe reads as
       * a diagram: land meets sea at a hard line that nothing in nature makes.
       * A wide, heavily blurred light line along the shore - and only the
       * shore, which is why the coastline has its own file rather than being
       * taken from the country outlines - puts it back.
       *
       * Under the land, so the glow spreads into the water and not over the
       * beach.
       */
      {
        id: 'shelf',
        type: 'line',
        source: 'coastline',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': colors.shelf,
          'line-width': ['interpolate', ['linear'], ['zoom'], 0, 7, 3, 20, 6, 46],
          'line-blur': ['interpolate', ['linear'], ['zoom'], 0, 7, 3, 18, 6, 40],
          'line-opacity': 0.34,
        },
      },
      {
        id: 'land',
        type: 'fill',
        source: 'land',
        paint: {
          /*
           * Colour by the belt the ground is in, cut at build time.
           *
           * One colour, and the variation comes from real geography drawn on
           * top of it: the physical regions below, and the ice above.
           *
           * Two things have been tried here and both drew lines. A wash of
           * coloured latitude bands over the whole sphere striped the ocean;
           * cutting the land itself into belts kept the sea clean but put a
           * straight horizontal edge through the middle of every continent a
           * belt boundary crossed. A line of latitude is a straight line
           * however it is drawn, and there are none on a planet.
           */
          'fill-color': colors.land,
          // Off: the land is many polygons - every island is one, and every
          // belt cuts more - and antialiasing each against its neighbour
          // draws a hairline down every strait and along every cut.
          'fill-antialias': false,
        },
      },
      /*
       * Relief, at the scale a whole planet shows it.
       *
       * Not a height map - there is no elevation raster here and there is not
       * going to be one. This is mottle: patches of forest, dry olive and bare
       * brown, drawn over every country's own fill so that a continent has the
       * variation a continent has. It sits under the seasonal wash and under
       * the deserts, both of which are claims; this one is only texture.
       */
      {
        id: 'land-texture',
        type: 'fill',
        source: 'land',
        paint: {
          'fill-antialias': false,
          'fill-pattern': 'land-grain',
          'fill-opacity': ['interpolate', ['linear'], ['zoom'], 0, 1, 4, 0.7],
        },
      },
      /*
       * There is no vegetation wash any more.
       *
       * It was a set of coloured latitude bands drawn over the whole globe at
       * low opacity - land and sea alike - to say that the tropics are darker
       * than a temperate summer. Over the ocean it was horizontal stripes.
       * What varies the ground now is the physical regions below, which are
       * real places with real outlines.
       */
      ...physical,
      sand,
      /*
       * The ice, where the ice is.
       *
       * Greenland, Antarctica, the icefields and the shelves, from Natural
       * Earth - see `buildIce` in `scripts/build-geo.mjs`. This is the third
       * attempt at white on this globe and the only one with no straight
       * edge in it: the first drew latitude quads over the whole sphere and
       * ruled a line through the Arctic Ocean, the second cut the land at
       * the polar circles and ruled one through Siberia.
       */
      {
        id: 'ice',
        type: 'fill',
        source: 'ice',
        paint: {
          'fill-color': colors.ice,
          // On at globe size, where it is a shape; softer close in, where the
          // grain underneath should still read through it.
          'fill-opacity': ['interpolate', ['linear'], ['zoom'], 0, 0.82, 4, 0.66],
          'fill-antialias': false,
        },
      },
      /*
       * There are no latitude bands any more.
       *
       * The season used to be painted as ninety quads spanning every
       * longitude, tinted for ice, snow and tundra, with a grain pattern
       * over the white ones. Each quad is a rectangle in a plate carree and
       * a straight line of latitude on the sphere, so what it actually drew
       * was a set of rules across the planet - over the ocean, through the
       * middle of continents, and stacked into a banded dome at the poles.
       * Making them finer made the steps smaller without making them lines
       * any less.
       *
       * Latitude still decides what colour the ground is. It now does it by
       * cutting the land itself into belts at build time - see `BELTS` in
       * `scripts/build-geo.mjs` - so every edge the eye can find is a
       * coastline, and the sea is never painted at all.
       */
      /*
       * The photograph.
       *
       * NASA's Blue Marble, cut into tiles by `scripts/build-earth-texture.mjs`
       * and served from our own origin. It sits over every flat fill below -
       * land, relief, sand and ice - which stay in the style as the colour the
       * globe shows while its tiles are still arriving, and under the night,
       * the lights and everything the product itself draws.
       */
      earthLayer('earth', 'earth', 1, options.earthMonth),
      {
        id: 'poles',
        type: 'fill',
        source: 'poles',
        paint: { 'fill-color': ['get', 'colour'], 'fill-antialias': false },
      },
      /*
       * The country under the pointer, as a wash rather than an outline.
       *
       * Invisible until it is hovered or selected. This is the layer the
       * globe's click, hover and selection all bind to: it is the only thing
       * on the sphere that knows which country a pixel belongs to, and it
       * says so by lighting up rather than by being drawn round.
       */
      {
        id: 'countries',
        type: 'fill',
        source: 'world',
        paint: {
          'fill-color': colors.landLit,
          'fill-opacity': [
            'case',
            ['boolean', ['feature-state', 'selected'], false],
            0.24,
            ['boolean', ['feature-state', 'hover'], false],
            0.14,
            0,
          ],
          'fill-opacity-transition': { duration: 180 },
          'fill-antialias': false,
        },
      },
      /*
       * Where one country ends and the next begins.
       *
       * Nothing at globe zoom. A whole planet ruled into a hundred and
       * seventy-seven outlined cells is a political map, and the point of
       * the sphere on the front page is that it is a place rather than a
       * diagram - the last time these were drawn there they were the first
       * thing that gave it away.
       *
       * Zoomed in they are exactly what is wanted, because by then the
       * question has changed from "what does the world look like" to "which
       * country am I looking at". So they fade up across the same range the
       * finer coastline file loads over, and they stay thin and cool: a
       * border is a fact about the ground, not a thing to look at.
       */
      {
        id: 'country-borders',
        type: 'line',
        source: 'world',
        layout: { 'line-join': 'round' },
        paint: {
          'line-color': '#ffffff',
          'line-width': ['interpolate', ['linear'], ['zoom'], 0, 0.4, 5, 0.8, 8, 1.1],
          // Thin and faint on the photograph: a border is a fact, not a picture.
          'line-opacity': ['interpolate', ['linear'], ['zoom'], 0, 0.12, 4, 0.2, 6, 0.4],
        },
      },
      /*
       * The night.
       *
       * A cap around whichever pole is in darkness, recomputed from the clock
       * every minute by the stage. Drawn over everything on the ground and
       * under the prices, which have to stay readable at any hour.
       *
       * This is the single thing that makes a drawn planet read as a planet
       * rather than as a map of one.
       */
      /*
       * The night, drawn eight times over.
       *
       * Each cap is the dark half as it stands a few minutes either side of
       * now - see `DUSK_STEPS` in `terminator.ts` - and each contributes a
       * fraction of the darkness. Where all eight overlap it is fully night;
       * at the edges only one or two reach, and the fall-off is a staircase
       * whose steps are a few pixels wide rather than a single hard line.
       *
       * They have to be separate layers. Overlapping polygons inside one
       * fill layer are flattened before the layer's opacity is applied, so a
       * single layer would give back exactly the hard edge this replaces.
       *
       * Dark enough to be night, and no darker: at nine-tenths the dark side
       * was a hole and the continents in it vanished. This leaves the land
       * faintly there in blue-grey, which is what the night side of the
       * Earth looks like between the lit parts.
       */
      ...Array.from({ length: DUSK_STEPS }, (_unused, depth) => ({
        id: `night-${depth}`,
        type: 'fill' as const,
        source: 'sun',
        filter: ['all', ['==', ['get', 'kind'], 'night'], ['==', ['get', 'depth'], depth]] as never,
        paint: {
          'fill-color': colors.night,
          'fill-opacity': DUSK_STEP_ALPHA,
          // Off, or each cap's own edge is antialiased into a hairline and
          // the staircase reads as eight lines drawn across the planet.
          'fill-antialias': false,
        },
      })),
      /*
       * The day dimming towards dusk.
       *
       * The night cap has an edge, because a polygon has an edge, and that
       * edge was the single thing that made the terminator read as drawn.
       * This is a very wide, very blurred dark line sitting exactly on it:
       * on the night side it is lost in a cap that is already dark, and on
       * the day side it is a gradient running into the boundary - which is
       * what the last hour before sunset actually looks like from orbit.
       *
       * Under the warm line, so dusk is the brightest thing at the boundary.
       */
      {
        id: 'twilight-shade',
        type: 'line',
        source: 'sun',
        filter: ['==', ['get', 'kind'], 'terminator'],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': warmEdge(colors.night, colors.twilight),
          /*
           * Wide enough that the cap's own edge cannot be found.
           *
           * The night is a polygon and a polygon has a boundary; the only way
           * for there to be no discernible edge on the sphere is for the ramp
           * across it to be wider than anybody's eye can localise. At hero
           * size this is most of the width of a continent, which is roughly
           * what the real thing is.
           */
          /*
           * Wide enough to hide the cap's edge, narrow enough to be dusk.
           *
           * These are pixels on the glass, not degrees on the planet, and the
           * sphere is about six hundred of them across on the front page. At
           * 320 wide with 380 of blur the ramp reached further than the whole
           * globe: the day side went dark, lost its colour, and the thing
           * stopped being watchable. A third of the disc is a terminator; the
           * whole disc is a veil.
           */
          /*
           * Narrow now, because the cliff is gone.
           *
           * This used to be the whole transition and had to be wide enough
           * to hide a hard edge, which meant a veil over a third of the
           * disc: the day side went dark, lost its colour, and the globe
           * stopped being watchable. The swept caps above carry the dusk;
           * all this has left to do is round off their staircase, so it is
           * about as wide as one of the steps.
           */
          'line-width': ['interpolate', ['linear'], ['zoom'], 0, 14, 4, 60],
          'line-blur': ['interpolate', ['linear'], ['zoom'], 0, 26, 4, 110],
          'line-opacity': 0.34,
        },
      },
      /*
       * There is no dusk line any more.
       *
       * A warm blurred line sitting on the terminator is how an atlas draws
       * one, and on a sphere it is a bright crescent seam - a drawn edge
       * across the planet, which is the single thing that gives the whole
       * picture away. The transition is now carried entirely by the wide
       * dark ramp above and by the night cap's own softness: the day dims
       * into darkness over roughly fifteen degrees and nothing marks where.
       *
       * The `terminator` feature is still produced by `sunGeoJson`, and the
       * layer that used it is what was removed - not the geometry, which the
       * ramp above is drawn from.
       */
      /*
       * The lights of the cities that are in darkness.
       *
       * Forty-two thousand points thresholded out of NASA's Black Marble
       * composite - see `scripts/build-city-lights.mjs` - each carrying the
       * brightness of the pixel it came from as `i`. Radius, opacity and
       * warmth all read that, so a city is a bright warm smear and a road
       * between two of them is a thin cool thread, which is what the night
       * side of the Earth actually looks like.
       *
       * How far under the horizon the sun is where each one stands still
       * decides whether it is lit at all; that expression is unchanged. They
       * carry no name, no price and no link: this is geography, like the
       * coastline, and a city we cannot price must never look like a
       * destination we can.
       */
      /*
       * The bloom under the lights.
       *
       * A city seen from orbit is not a dot, it is a smear: the light is
       * scattered by the air above it and by the cloud around it, and the
       * brighter the city the wider the smear. Two layers, because one circle
       * cannot be both a point and a haze - a wide soft one under a small
       * sharp one is the whole of what makes a night side read as inhabited
       * rather than as speckled.
       */
      {
        id: 'city-lights-bloom',
        type: 'circle',
        source: 'city-lights',
        // Nothing above 78 degrees: the composite's top rows are glare, and a row of
        // 'lights' at one latitude is a glowing ring round the pole.
        filter: ['<', ['abs', ['get', 'lat']], 78],
        paint: {
          'circle-color': lightColour(colors),
          'circle-radius': ['interpolate', ['linear'], ['get', 'i'], 0, 2, 1, 6],
          'circle-blur': 2,
          // Enough bloom to join a conurbation together, not so much that the
          // dark ground between the lit parts disappears under it.
          'circle-opacity': cityLightPaint(CITY_LIGHT_LAYERS[1][1], options.solar) as never,
        },
      },
      {
        id: 'city-lights',
        type: 'circle',
        source: 'city-lights',
        // Nothing above 78 degrees: the composite's top rows are glare, and a row of
        // 'lights' at one latitude is a glowing ring round the pole.
        filter: ['<', ['abs', ['get', 'lat']], 78],
        paint: {
          'circle-color': lightColour(colors),
          'circle-radius': ['interpolate', ['linear'], ['get', 'i'], 0, 0.6, 1, 2],
          // The glow. A hard dot at this size reads as a pixel fault; a blurred
          // one reads as a light seen through air.
          'circle-blur': 1.1,
          /*
           * Held back to two thirds.
           *
           * Forty-two thousand lights at full strength is a lit planet rather
           * than a dark one with lit parts, and the land between them stops
           * being visible at all. The brightest cores still reach two thirds;
           * the dimmest are a suggestion.
           */
          'circle-opacity': cityLightPaint(CITY_LIGHT_LAYERS[0][1], options.solar) as never,
        },
      },
      /*
       * Capitals, and the airports a trip can actually start from.
       *
       * Nothing at globe zoom: five hundred and sixty-seven dots over a whole
       * planet is a dot pattern, not information, and the front page already
       * says what it has to say with the city lights. They come in over the
       * same range as the borders, by which point the question is which place
       * is which.
       *
       * A capital is a ring - the cartographic convention, and it reads as a
       * marked place rather than as one more light - and an airport is a
       * smaller solid dot in the accent, because an airport is something the
       * search can be pointed at.
       */
      {
        id: 'airport-dots',
        type: 'circle',
        source: 'places',
        filter: ['==', ['get', 'kind'], 'airport'],
        paint: {
          // Real places, preloaded: small dim dots from the first frame, so the
          // globe shows somewhere to go on every side before any price arrives.
          // A priced place wears a pin instead (the stage filters those out).
          // By airport size (see `airport-size-style.ts`): large amber and biggest with a ring,
          // medium the accent, small the chip colour and smallest. A size not stated is medium.
          'circle-color': bySize((style) => colors[style.colorToken]) as never,
          'circle-radius': [
            'interpolate',
            ['linear'],
            ['zoom'],
            0,
            ['*', 1.1, bySize((style) => style.radiusScale)],
            3.4,
            ['*', 1.6, bySize((style) => style.radiusScale)],
            6,
            ['*', 2.6, bySize((style) => style.radiusScale)],
            9,
            ['*', 3.6, bySize((style) => style.radiusScale)],
          ] as never,
          'circle-opacity': ['interpolate', ['linear'], ['zoom'], 0, 0.5, 3.4, 0.6, 4.4, 0.85],
          'circle-stroke-color': colors.chip,
          'circle-stroke-width': bySize((style) => style.ring) as never,
        },
      },
      {
        id: 'capital-dots',
        type: 'circle',
        source: 'places',
        filter: ['==', ['get', 'kind'], 'capital'],
        paint: {
          // Hollow: the fill is the night colour, so the ring is what is seen.
          'circle-color': colors.night,
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 2.8, 1.6, 6, 3.2, 9, 4.4],
          'circle-opacity': ['interpolate', ['linear'], ['zoom'], 2.8, 0, 3.8, 0.75],
          'circle-stroke-color': colors.chip,
          'circle-stroke-width': 1.2,
          'circle-stroke-opacity': ['interpolate', ['linear'], ['zoom'], 2.8, 0, 3.8, 0.9],
        },
      },
      /*
       * The ground track.
       *
       * Faint, because the route itself now flies: the bright arc bowing over
       * the limb is drawn in SVG over the canvas - see `globe-arcs.ts` - and
       * this is the line it casts on the surface underneath. Two lines for
       * one journey is what a flight tracker looks like, and it is the reason
       * the arc reads as being above the planet rather than on it.
       *
       * It is also the only route drawing left when somebody switches to the
       * flat map, where there is no limb to bow over.
       */
      {
        id: 'routes',
        type: 'line',
        source: 'routes',
        filter: ['!', ['get', 'selected']],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-width': ['interpolate', ['linear'], ['get', 'rank'], 0, 1.2, 8, 0.7],
          'line-opacity': ['interpolate', ['linear'], ['get', 'rank'], 0, 0.3, 8, 0.14],
          // Fades in from the origin, so a route reads as leaving rather than
          // as a line between two dots.
          'line-gradient': [
            'interpolate',
            ['linear'],
            ['line-progress'],
            0,
            colors.origin,
            0.15,
            colors.route,
            1,
            colors.accent,
          ],
        },
      },
      /*
       * The traffic on the route.
       *
       * The same line again, dashed, with the dash pattern walked along it by
       * the stage's animation loop. It is the one thing on the globe that
       * says these are journeys rather than lines: something is moving from
       * the origin to each place.
       *
       * A dashed line cannot also be a gradient - `line-dasharray` and
       * `line-gradient` are mutually exclusive - so this is a flat pale line
       * over the gradient one rather than a replacement for it.
       */
      {
        id: 'routes-flow',
        type: 'line',
        source: 'routes',
        filter: ['!', ['get', 'selected']],
        layout: { 'line-cap': 'butt', 'line-join': 'round' },
        paint: {
          'line-color': colors.chip,
          'line-width': ['interpolate', ['linear'], ['get', 'rank'], 0, 1, 8, 0.6],
          'line-opacity': ['interpolate', ['linear'], ['get', 'rank'], 0, 0.22, 8, 0.1],
          'line-dasharray': [0, 3, 2],
        },
      },
      {
        id: 'routes-selected',
        type: 'line',
        source: 'routes',
        filter: ['get', 'selected'],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-width': 2.2,
          'line-opacity': 0.6,
          'line-gradient': [
            'interpolate',
            ['linear'],
            ['line-progress'],
            0,
            colors.origin,
            1,
            colors.chip,
          ],
        },
      },
      {
        id: 'origins-glow',
        type: 'circle',
        source: 'origins',
        paint: {
          'circle-radius': 12,
          'circle-color': colors.origin,
          'circle-opacity': 0.25,
          'circle-blur': 0.8,
        },
      },
      {
        id: 'origins',
        type: 'circle',
        source: 'origins',
        paint: {
          'circle-radius': 3.5,
          'circle-color': colors.chip,
        },
      },
      /*
       * Places too close together to chip separately.
       *
       * It carried its count in a violet disc, and a numbered badge pinned to
       * the middle of a flight path is a badge arguing with the line under
       * it and with whatever label is beside it. A cluster is now the same
       * white light every other place is, slightly larger - it says "places
       * here" and leaves the counting to the rail, which lists every one.
       */
      {
        id: 'clusters',
        type: 'circle',
        source: 'destinations',
        filter: ['has', 'point_count'],
        paint: {
          'circle-radius': ['step', ['get', 'point_count'], 5, 3, 6, 6, 7],
          'circle-color': colors.chip,
          'circle-opacity': 0.9,
        },
      },
      /*
       * A place is a light, not a pin.
       *
       * It used to be a white puck with a violet ring, which is a map symbol:
       * something drawn on top of the world to point at it. A small white dot
       * inside a soft halo is a light on the surface, which is the only thing
       * that belongs on a photograph of a planet.
       */
      {
        id: 'destination-glow',
        type: 'circle',
        source: 'destinations',
        filter: ['!', ['has', 'point_count']],
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 1, 9, 6, 16],
          'circle-color': colors.chip,
          'circle-opacity': 0.3,
          'circle-blur': 1,
        },
      },
      {
        id: 'destination-points',
        type: 'circle',
        source: 'destinations',
        filter: ['!', ['has', 'point_count']],
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 1, 3, 6, 5.5],
          'circle-color': colors.chip,
        },
      },
    ],
  } as StyleSpecification;
}
