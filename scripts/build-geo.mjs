#!/usr/bin/env node
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Build the geographic data the discovery globe draws.
 *
 * Fetches Natural Earth from the maintained GeoJSON mirror, keeps a fixed
 * allow-list of properties, reduces the geometry to what a globe can express,
 * and writes:
 *
 *  - `public/geo/countries-110m.v1.json` - country outlines at globe zoom,
 *    fetched by the browser on first paint.
 *  - `public/geo/countries-50m.v1.json` - the same countries in more detail,
 *    fetched once the map is zoomed far enough for the 110m coastline to look
 *    like a cartoon.
 *  - `public/geo/regions/{ADM0_A3}.v1.json` - the states and provinces of one
 *    country, fetched only when that country is opened.
 *  - `src/discovery/countries.generated.json` and `regions.generated.json` -
 *    the same countries, and a region count per country, without geometry, so
 *    the server can name and bound a country without parsing a coastline.
 *
 * Everything here is public domain. The outputs are committed and this script
 * is what makes them reproducible; the downloads are cached in `.geo-cache/`,
 * which is not.
 *
 * Keyed on `ADM0_A3`, not `ISO_A3`: Natural Earth sets the ISO code to -99 for
 * France, Norway, Kosovo and a few others, and `ADM0_A3` is always populated.
 *
 * **Nothing is ever silently dropped.** A region that vanished from the map
 * would be this product claiming a place does not exist, so precision adapts
 * to the size of what is being drawn and the build fails if a feature is lost.
 */

const MIRROR = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson';
const CACHE = '.geo-cache';

const VERSION = 2;

/**
 * Write a file under `public/geo/`, refusing to change one behind its name.
 *
 * **The service worker serves everything under `/geo/` cache-first, forever.**
 * It is allowed to, on the stated grounds that these names carry a version
 * and a rebuild produces a new one - so a URL's content never changes and a
 * cache keyed on the URL can never be stale.
 *
 * That is a real contract and it was broken by rebuilding `city-lights.v2`
 * and `land-50m.v1` in place: every browser that had already loaded the site
 * kept serving the old files out of its own cache, and no amount of
 * rebuilding or redeploying could reach it. It looked exactly like the fix
 * had not worked.
 *
 * So the build refuses. If the bytes for a name change, `VERSION` has to go
 * up, which is what makes the new data reach anyone who has been here before.
 */
async function writeVersioned(path, text) {
  if (existsSync(path) && (await readFile(path, 'utf8')) !== text) {
    throw new Error(
      `${path} already exists with different content. ` +
        `Bump VERSION (currently ${VERSION}) rather than rewriting a name the ` +
        `service worker has been told never changes.`,
    );
  }

  await writeFile(path, text);
}
const COUNTRIES_110M_OUT = `public/geo/countries-110m.v${VERSION}.json`;
const COUNTRIES_50M_OUT = `public/geo/countries-50m.v${VERSION}.json`;
const REGIONS_DIR = 'public/geo/regions';
const PHYSICAL_OUT = `public/geo/physical.v${VERSION}.json`;
const COASTLINE_OUT = `public/geo/coastline.v${VERSION}.json`;
const LAND_OUT = `public/geo/land-50m.v${VERSION}.json`;
const ICE_OUT = `public/geo/ice-50m.v${VERSION}.json`;
const PLACES_OUT = `public/geo/places.v${VERSION}.json`;
const COUNTRY_INDEX_OUT = 'src/discovery/countries.generated.json';
const REGION_INDEX_OUT = 'src/discovery/regions.generated.json';

/**
 * How much detail each output keeps.
 *
 * `decimals` is the coordinate grid: two is about a kilometre, which is the
 * finest a marker at country zoom can express. `tolerance` is the
 * Douglas-Peucker threshold in degrees, which removes the points that do not
 * change the shape at that grid.
 */
const DETAIL = {
  countries110m: { decimals: 2, tolerance: 0 },
  countries50m: { decimals: 2, tolerance: 0.01 },
  regions: { decimals: 2, tolerance: 0.02 },
  // Physical regions are drawn as a wash under everything else, so they can
  // lose a lot of shape before anybody could tell.
  physical: { decimals: 1, tolerance: 0.15 },
  // The shore is drawn as a wide, heavily blurred glow, so its shape can be
  // coarse: nobody can see a fjord through a thirty-pixel blur.
  coastline: { decimals: 1, tolerance: 0.6 },
  // The land itself, and the one shape on the globe somebody looks straight
  // at. Finer than the coastline glow drawn along it and finer than the
  // country outlines it replaced, because the silhouette of a continent is
  // the whole picture.
  land: { decimals: 2, tolerance: 0.02 },
};

/**
 * The physical regions worth drawing, and what to call each on the map.
 *
 * Natural Earth's `FEATURECLA` has twenty-one classes; these are the ones
 * that say something about what a place is like to be in. Islands, capes and
 * coasts are shapes the coastline already draws, so they are left out.
 */
const PHYSICAL_KINDS = {
  'Range/mtn': 'mountains',
  Desert: 'desert',
  Plateau: 'plateau',
  Tundra: 'tundra',
  Plain: 'plain',
  Basin: 'basin',
};

/** Natural Earth has shipped these both upper- and lower-cased across releases. */
function property(properties, name) {
  return properties[name] ?? properties[name.toLowerCase()] ?? properties[name.toUpperCase()];
}

function required(feature, name) {
  const value = property(feature.properties, name);
  if (value === undefined) {
    const label = property(feature.properties, 'NAME') ?? '(unnamed)';
    throw new Error(`Feature ${JSON.stringify(label)} has no ${name}`);
  }
  return value;
}

function round(value, factor) {
  return Math.round(value * factor) / factor;
}

/** Perpendicular distance from `point` to the segment `a`-`b`, in degrees. */
function segmentDistance(point, a, b) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];

  if (dx === 0 && dy === 0) return Math.hypot(point[0] - a[0], point[1] - a[1]);

  const along = ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / (dx * dx + dy * dy);
  const t = Math.max(0, Math.min(1, along));

  return Math.hypot(point[0] - (a[0] + t * dx), point[1] - (a[1] + t * dy));
}

/**
 * Ramer-Douglas-Peucker, iteratively.
 *
 * Iterative rather than recursive because a coastline ring runs to tens of
 * thousands of points and the recursive form overflows the stack on the worst
 * of them.
 */
function simplify(points, tolerance) {
  if (tolerance <= 0 || points.length < 3) return points;

  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;

  const stack = [[0, points.length - 1]];

  while (stack.length > 0) {
    const [start, end] = stack.pop();
    let furthest = 0;
    let index = -1;

    for (let i = start + 1; i < end; i += 1) {
      const distance = segmentDistance(points[i], points[start], points[end]);
      if (distance > furthest) {
        furthest = distance;
        index = i;
      }
    }

    if (index !== -1 && furthest > tolerance) {
      keep[index] = 1;
      stack.push([start, index], [index, end]);
    }
  }

  return points.filter((_, index) => keep[index] === 1);
}

/** Round a ring onto the grid, dropping the points rounding made identical. */
function snap(points, factor) {
  const out = [];

  for (const [x, y] of points) {
    const point = [round(x, factor), round(y, factor)];
    const last = out[out.length - 1];
    if (!last || last[0] !== point[0] || last[1] !== point[1]) out.push(point);
  }

  return out;
}

function close(points) {
  const first = points[0];
  const last = points[points.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) points.push([first[0], first[1]]);
  return points;
}

/**
 * One ring, reduced as far as it can go without disappearing.
 *
 * A shape smaller than the grid keeps a finer grid rather than collapsing:
 * Monaco and Gibraltar are real places, and a build that quietly lost them
 * would be drawing a map that disagrees with the world.
 */
function reduceRing(points, { decimals, tolerance }) {
  for (const attempt of [decimals, decimals + 2, decimals + 4]) {
    const snapped = snap(points, 10 ** attempt);
    if (snapped.length < 4) continue;

    const simplified = simplify(snapped, tolerance);
    return close(simplified.length >= 4 ? simplified : snapped);
  }

  return null;
}

function reducePolygon(rings, detail) {
  // The first ring is the outer boundary; without it the holes mean nothing.
  const outer = reduceRing(rings[0], detail);
  if (!outer) return null;

  const holes = rings.slice(1).map((ring) => reduceRing(ring, detail));

  return [outer, ...holes.filter(Boolean)];
}

function reduceGeometry(geometry, detail) {
  if (geometry.type === 'Polygon') {
    const polygon = reducePolygon(geometry.coordinates, detail);
    return polygon ? { type: 'Polygon', coordinates: polygon } : null;
  }

  if (geometry.type === 'MultiPolygon') {
    const polygons = geometry.coordinates
      .map((rings) => reducePolygon(rings, detail))
      .filter(Boolean);

    if (polygons.length === 0) return null;

    return polygons.length === 1
      ? { type: 'Polygon', coordinates: polygons[0] }
      : { type: 'MultiPolygon', coordinates: polygons };
  }

  /*
   * A line is not a ring: it must not be closed, and it must not be dropped
   * for having fewer than four points. A two-point shore is a shore.
   */
  if (geometry.type === 'LineString') {
    const line = simplify(snap(geometry.coordinates, 10 ** detail.decimals), detail.tolerance);
    return line.length >= 2 ? { type: 'LineString', coordinates: line } : null;
  }

  if (geometry.type === 'MultiLineString') {
    const lines = geometry.coordinates
      .map((line) => simplify(snap(line, 10 ** detail.decimals), detail.tolerance))
      .filter((line) => line.length >= 2);

    if (lines.length === 0) return null;

    return lines.length === 1
      ? { type: 'LineString', coordinates: lines[0] }
      : { type: 'MultiLineString', coordinates: lines };
  }

  throw new Error(`Unexpected geometry type ${geometry.type}`);
}

/** Twice the signed area of a ring, by the shoelace formula. */
function ringArea(ring) {
  let sum = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    sum += (ring[j][0] - ring[i][0]) * (ring[j][1] + ring[i][1]);
  }
  return sum;
}

/** The area-weighted centroid of one ring. */
function ringCentroid(ring) {
  let x = 0;
  let y = 0;
  let area = 0;

  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const cross = ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
    area += cross;
    x += (ring[j][0] + ring[i][0]) * cross;
    y += (ring[j][1] + ring[i][1]) * cross;
  }

  if (area === 0) return [ring[0][0], ring[0][1]];
  return [x / (3 * area), y / (3 * area)];
}

/**
 * Where to write a shape's name.
 *
 * One point per feature, at the centroid of its largest part. MapLibre places
 * a symbol on every part of a multi-part geometry, so Spain drawn with its
 * islands gets labelled three times and Italy four - which reads as a bug
 * rather than as a map. Deciding this at build time keeps the renderer doing
 * what the rest of this codebase asks of it: drawing what it is handed.
 *
 * The centroid of the largest part, rather than the pole of inaccessibility,
 * because at the zoom a country label appears the difference is a few pixels
 * and the shapes it would matter for - a crescent, a horseshoe - are not
 * countries.
 */
function labelPoint(geometry) {
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;

  let largest = null;
  let largestArea = -1;

  for (const rings of polygons) {
    const area = Math.abs(ringArea(rings[0]));
    if (area > largestArea) {
      largestArea = area;
      largest = rings[0];
    }
  }

  const [lon, lat] = ringCentroid(largest);
  return [round(lon, 100), round(lat, 100)];
}

function positions(geometry) {
  const rings = geometry.type === 'Polygon' ? geometry.coordinates : geometry.coordinates.flat();
  return rings.flat();
}

/**
 * A bounding box the globe can fly to.
 *
 * `[west, south, east, north]`. For a country that crosses the antimeridian -
 * Russia, Fiji, the United States by way of the Aleutians - `east` is written
 * beyond 180 so the box stays a box rather than wrapping the whole planet.
 * MapLibre accepts longitudes outside the usual range and wraps them itself.
 * Antarctica genuinely spans every longitude and keeps the full range.
 */
function boundingBox(geometry) {
  const points = positions(geometry);
  const lats = points.map(([, lat]) => lat);
  const lons = points.map(([lon]) => lon);

  const south = Math.min(...lats);
  const north = Math.max(...lats);
  const west = Math.min(...lons);
  const east = Math.max(...lons);

  if (east - west <= 180) return [west, south, east, north];

  // Try the same points with the western hemisphere shifted past 180. If that
  // makes the country narrower, it crosses the antimeridian.
  const shifted = lons.map((lon) => (lon < 0 ? lon + 360 : lon));
  const shiftedWest = Math.min(...shifted);
  const shiftedEast = Math.max(...shifted);

  if (shiftedEast - shiftedWest < east - west) {
    return [round(shiftedWest, 100), south, round(shiftedEast, 100), north];
  }

  return [west, south, east, north];
}

/** Fetch a source, keeping a copy so a rebuild does not re-download 40MB. */
async function source(name) {
  const cached = join(CACHE, `${name}.geojson`);

  if (existsSync(cached)) {
    process.stdout.write(`Using cached ${name}\n`);
    return JSON.parse(await readFile(cached, 'utf8'));
  }

  process.stdout.write(`Fetching ${name}\n`);
  const response = await fetch(`${MIRROR}/${name}.geojson`);
  if (!response.ok) {
    throw new Error(`Fetch failed for ${name}: ${response.status} ${response.statusText}`);
  }

  const text = await response.text();
  await mkdir(CACHE, { recursive: true });
  await writeFile(cached, text);

  return JSON.parse(text);
}

function kilobytes(text) {
  return `${Math.round(text.length / 1024)}kB`;
}

async function buildCountries() {
  const coarse = await source('ne_110m_admin_0_countries');
  const fine = await source('ne_50m_admin_0_countries');

  const features = [];
  const index = [];

  for (const feature of coarse.features) {
    const geometry = reduceGeometry(feature.geometry, DETAIL.countries110m);
    if (!geometry) throw new Error(`${required(feature, 'NAME')} collapsed entirely`);

    const entry = {
      adm0: required(feature, 'ADM0_A3'),
      iso2: required(feature, 'ISO_A2_EH'),
      name: required(feature, 'NAME_LONG'),
      shortName: required(feature, 'NAME'),
      continent: required(feature, 'CONTINENT'),
      subregion: required(feature, 'SUBREGION'),
      bbox: boundingBox(geometry),
    };

    features.push({ type: 'Feature', properties: entry, geometry });
    index.push(entry);
  }

  if (new Set(index.map((entry) => entry.adm0)).size !== index.length) {
    throw new Error('ADM0_A3 keys are not unique');
  }

  /*
   * The detailed outlines carry the three things an interaction needs - the
   * key, the name to say and the box to fly to - and nothing else. A hover or
   * a click has to behave the same whichever resolution is being drawn, and
   * the rest of what is known about a country is in the index already.
   *
   * The box comes from the coarse geometry rather than the fine one, so that
   * clicking a country flies to exactly the same place before and after the
   * detail has loaded.
   */
  const byKey = new Map(index.map((entry) => [entry.adm0, entry]));
  const detailed = [];

  for (const feature of fine.features) {
    const geometry = reduceGeometry(feature.geometry, DETAIL.countries50m);
    if (!geometry) throw new Error(`${required(feature, 'NAME')} collapsed entirely at 50m`);

    const adm0 = required(feature, 'ADM0_A3');
    const coarseEntry = byKey.get(adm0);

    detailed.push({
      type: 'Feature',
      properties: {
        adm0,
        shortName: coarseEntry?.shortName ?? required(feature, 'NAME'),
        bbox: coarseEntry?.bbox ?? boundingBox(geometry),
      },
      geometry,
    });
  }

  index.sort((a, b) => a.name.localeCompare(b.name, 'en'));

  /*
   * No label points any more.
   *
   * There was one per country, so a country with islands got named once.
   * The sphere carries no text at all now - see the note at the top of
   * `globe-style.ts` - so the file was a download nothing read.
   */
  const coarseText = JSON.stringify({ type: 'FeatureCollection', features });
  const fineText = JSON.stringify({ type: 'FeatureCollection', features: detailed });

  await mkdir('public/geo', { recursive: true });
  await writeVersioned(COUNTRIES_110M_OUT, coarseText);
  await writeVersioned(COUNTRIES_50M_OUT, fineText);
  await writeFile(
    COUNTRY_INDEX_OUT,
    `${JSON.stringify(index, null, 2)}
`,
  );

  process.stdout.write(
    `  ${features.length} countries at 110m (${kilobytes(coarseText)}) and ` +
      `${detailed.length} at 50m (${kilobytes(fineText)})
`,
  );

  return index;
}

/**
 * The shape of the land itself: mountain ranges, deserts, plateaus, plains.
 *
 * Natural Earth's physical regions, which is real surveyed geography rather
 * than a texture - the Alps are where the Alps are, and the Sahara has the
 * outline the Sahara has. It is what lets the globe look like somewhere
 * without a satellite imagery vendor in the render path.
 *
 * Kept separate from the seasonal model in `src/discovery/seasons.ts` on
 * purpose, and the split is the honest one: this file is the permanent
 * geography, and the season is a model of where the sun is. A desert drawn
 * here is a desert; snow drawn there is an inference about sunlight.
 */
async function buildPhysical() {
  const regions = await source('ne_50m_geography_regions_polys');

  const features = [];

  for (const feature of regions.features) {
    const kind = PHYSICAL_KINDS[property(feature.properties, 'FEATURECLA')];
    if (!kind) continue;

    const geometry = reduceGeometry(feature.geometry, DETAIL.physical);
    if (!geometry) continue;

    /*
     * Shape and kind only.
     *
     * These used to carry the region's name and the zoom Natural Earth judged
     * it worth labelling at, for a symbol layer that drew "Sahara" and
     * "Amazon Basin" across the globe. There is no text on the sphere now, so
     * what is left is what is actually drawn: a polygon and which of six
     * kinds of ground it is.
     */
    features.push({ type: 'Feature', properties: { kind }, geometry });
  }

  /*
   * No named peaks any more, for the same reason as the country labels: a
   * triangle and a mountain's name is a map's furniture, and the sphere has
   * none. The elevation points are still downloaded, because the physical
   * regions above come out of the same file.
   */
  const physicalText = JSON.stringify({ type: 'FeatureCollection', features });

  await writeVersioned(PHYSICAL_OUT, physicalText);

  const counts = {};
  for (const feature of features) {
    counts[feature.properties.kind] = (counts[feature.properties.kind] ?? 0) + 1;
  }

  process.stdout.write(
    `  ${features.length} physical regions (${kilobytes(physicalText)}) - ` +
      `${Object.entries(counts)
        .map(([kind, count]) => `${count} ${kind}`)
        .join(', ')}
`,
  );
}

/**
 * The coastline, on its own.
 *
 * The country file already has coastlines in it, but its outlines are
 * *borders* - every internal frontier as well as every shore. The globe draws
 * a wide, soft light along the water's edge to stand in for the continental
 * shelf, which is the shallow pale band around every landmass in a photograph
 * of the Earth, and drawing that along the France-Germany border would be
 * absurd. So the shore gets its own file.
 */
/**
 * The land, as land.
 *
 * Natural Earth publishes `ne_50m_land` as one dissolved layer: continents and
 * islands, with no internal boundaries at all. That is exactly what the globe
 * wants now that it draws no borders - a single silhouette at fifty-million
 * scale, rather than a hundred and seventy-seven country polygons that have
 * to be painted the same colour and then antialiased against each other.
 *
 * The countries file stays, and is still fetched: it carries the identity a
 * click on the globe resolves to. It is simply not what gets drawn.
 *
 * **It is not cut into latitude belts.** It was, to give the ground a colour
 * that changed with latitude - but a belt boundary is a line of latitude, and
 * a line of latitude across a continent is a straight horizontal edge drawn
 * through the middle of China. What the ground actually looks like is already
 * published: `buildPhysical` carries real deserts, plateaus and basins, and
 * `buildIce` the glaciers. Those have coastlines and edges that came from
 * somewhere, and none of them is straight.
 */
async function buildLand() {
  const land = await source('ne_50m_land');

  const features = [];

  for (const feature of land.features) {
    const geometry = reduceGeometry(feature.geometry, DETAIL.land);
    if (!geometry) continue;

    features.push({ type: 'Feature', properties: {}, geometry });
  }

  if (features.length < 50) {
    throw new Error(`Expected land of many parts, built ${features.length}`);
  }

  const text = JSON.stringify({ type: 'FeatureCollection', features });
  await writeVersioned(LAND_OUT, text);

  process.stdout.write(`  ${features.length} land parts (${kilobytes(text)})
`);
}

/**
 * The ice, from where the ice actually is.
 *
 * `ne_50m_glaciated_areas` is the Greenland and Antarctic sheets plus every
 * icefield big enough to see at this scale; the ice shelves are a separate
 * layer because they float rather than sit on rock, and on a globe at this
 * size they read as the same white. Both are real outlines, which is the
 * entire point - the white on the map is where the ice is, not everything
 * north of a number.
 */
async function buildIce() {
  const features = [];

  for (const name of ['ne_50m_glaciated_areas', 'ne_50m_antarctic_ice_shelves_polys']) {
    const collection = await source(name);

    for (const feature of collection.features) {
      const geometry = reduceGeometry(feature.geometry, DETAIL.land);
      if (!geometry) continue;

      features.push({ type: 'Feature', properties: {}, geometry });
    }
  }

  const text = JSON.stringify({ type: 'FeatureCollection', features });
  await writeVersioned(ICE_OUT, text);

  process.stdout.write(`  ${features.length} ice parts (${kilobytes(text)})
`);
}

/**
 * A point, at the only precision a globe can draw.
 *
 * Two decimals is about a kilometre, which is finer than a four-pixel dot
 * at any zoom this map reaches, and a third of the file size of the six
 * decimals Natural Earth ships.
 */
function point(geometry) {
  const [longitude = 0, latitude = 0] = geometry.coordinates;

  return { type: 'Point', coordinates: [round(longitude, 100), round(latitude, 100)] };
}

/**
 * The places worth naming: capitals, and the airports a trip starts from.
 *
 * Two Natural Earth layers into one file, because they are drawn together
 * and asked for together. Each feature carries a `kind` so the style can
 * filter it, and a rank so the labels can be thinned by importance rather
 * than by whatever order the file happened to be in.
 *
 * **Only major airports.** `ne_10m_airports` has nine hundred entries down to
 * airfields with a windsock, and an airport nobody can fly a trip from is a
 * dot that means nothing. Filtered to the ones Natural Earth calls major and
 * that have an IATA code, because the IATA code is what the search actually
 * takes - a dot on the globe the user cannot type into the form is decoration
 * pretending to be data.
 */
async function buildPlaces() {
  const features = [];

  const cities = await source('ne_50m_populated_places');

  for (const feature of cities.features) {
    const p = feature.properties ?? {};
    if (p.ADM0CAP !== 1) continue;

    const name = typeof p.NAME === 'string' ? p.NAME : null;
    if (!name || feature.geometry?.type !== 'Point') continue;

    features.push({
      type: 'Feature',
      properties: {
        kind: 'capital',
        name,
        adm0: typeof p.ADM0_A3 === 'string' ? p.ADM0_A3 : null,
        // Natural Earth's label rank runs the wrong way round - 1 is the most
        // important - so it is flipped here into something that sorts big
        // first alongside the airports.
        rank: 10 - (Number(p.LABELRANK) || 10),
      },
      geometry: point(feature.geometry),
    });
  }

  const airports = await source('ne_10m_airports');

  for (const feature of airports.features) {
    const p = feature.properties ?? {};
    if (p.type !== 'major') continue;

    const iata = typeof p.iata_code === 'string' ? p.iata_code.trim() : '';
    const name = typeof p.name === 'string' ? p.name : null;
    if (iata.length !== 3 || !name || feature.geometry?.type !== 'Point') continue;

    features.push({
      type: 'Feature',
      properties: {
        kind: 'airport',
        name,
        iata,
        rank: 10 - (Number(p.scalerank) || 10),
      },
      geometry: point(feature.geometry),
    });
  }

  const text = JSON.stringify({ type: 'FeatureCollection', features });
  await writeVersioned(PLACES_OUT, text);

  const capitals = features.filter((feature) => feature.properties.kind === 'capital').length;

  process.stdout.write(
    `  ${capitals} capitals and ${features.length - capitals} major airports (${kilobytes(text)})
`,
  );
}

async function buildCoastline() {
  const coastline = await source('ne_50m_coastline');

  const features = [];

  for (const feature of coastline.features) {
    const geometry = reduceGeometry(feature.geometry, DETAIL.coastline);
    if (!geometry) continue;

    features.push({ type: 'Feature', properties: {}, geometry });
  }

  if (features.length < 100) {
    throw new Error(`Expected a coastline of many parts, built ${features.length}`);
  }

  const text = JSON.stringify({ type: 'FeatureCollection', features });
  await writeVersioned(COASTLINE_OUT, text);

  process.stdout.write(`  ${features.length} coastline parts (${kilobytes(text)})\n`);
}

/**
 * The lights of the night side.
 *
 * Natural Earth's populated places, reduced to a point and a population. The
 * globe draws these as small warm dots whose brightness is computed from where
 * the sun is, so they appear only on the half of the planet that is in
 * darkness - which is the single thing that makes a globe read as a planet
 * rather than as a map of one.
 *
 * Nothing here is a claim about a destination. These are cities, not places
 * this product can price, and they carry no price, no link and no name. They
 * are the same class of thing as the coastline: geography, drawn because it is
 * there.
 */
/*
 * `ne_50m_geography_regions_elevation_points` is no longer downloaded either:
 * it existed only for the named peaks.
 *
 * The night lights used to be built here, out of Natural Earth's six hundred
 * populated places. They are now thresholded out of NASA's Black Marble
 * composite by `scripts/build-city-lights.mjs`, which produces forty-two
 * thousand of them with an intensity each - six hundred dots is confetti, not
 * a night side.
 */

async function buildRegions(countries) {
  const admin1 = await source('ne_10m_admin_1_states_provinces');
  const known = new Set(countries.map((country) => country.adm0));

  const byCountry = new Map();
  let lost = 0;

  for (const feature of admin1.features) {
    const adm0 = property(feature.properties, 'adm0_a3');
    // A region of a country the globe cannot draw has nowhere to be shown.
    if (!known.has(adm0)) continue;

    const geometry = reduceGeometry(feature.geometry, DETAIL.regions);
    if (!geometry) {
      lost += 1;
      process.stdout.write(
        `  lost ${JSON.stringify(property(feature.properties, 'name'))} in ${adm0}\n`,
      );
      continue;
    }

    // `name_en` where Natural Earth has one, because the rest of the
    // interface is in English and a mixed-language map reads as a bug.
    const name = property(feature.properties, 'name_en') || property(feature.properties, 'name');
    const properties = {
      name,
      code: property(feature.properties, 'iso_3166_2') || null,
    };

    const list = byCountry.get(adm0) ?? [];
    // The outline, and beside it the one point its name is written at. Both
    // in the same file because they are fetched together and drawn together;
    // the layers tell them apart by geometry type.
    list.push({ type: 'Feature', properties, geometry });
    list.push({
      type: 'Feature',
      properties,
      geometry: { type: 'Point', coordinates: labelPoint(geometry) },
    });
    byCountry.set(adm0, list);
  }

  if (lost > 0) {
    throw new Error(`${lost} regions collapsed; a region that vanishes is a place denied`);
  }

  // Rebuilt from scratch, so a country that lost its regions upstream does not
  // keep serving the ones from the last build.
  await rm(REGIONS_DIR, { recursive: true, force: true });
  await mkdir(REGIONS_DIR, { recursive: true });

  const index = {};
  let total = 0;

  for (const [adm0, features] of [...byCountry].sort(([a], [b]) => a.localeCompare(b))) {
    features.sort((a, b) =>
      String(a.properties.name).localeCompare(String(b.properties.name), 'en'),
    );

    const text = JSON.stringify({ type: 'FeatureCollection', features });
    await writeVersioned(join(REGIONS_DIR, `${adm0}.v${VERSION}.json`), text);

    // Each region is an outline and a label point, and a reader counting
    // regions means the places, not the features drawn for them.
    index[adm0] = features.length / 2;
    total += text.length;
  }

  await writeFile(REGION_INDEX_OUT, `${JSON.stringify(index, null, 2)}\n`);

  process.stdout.write(
    `  ${Object.keys(index).length} countries with regions, ` +
      `${Object.values(index).reduce((sum, count) => sum + count, 0)} regions, ` +
      `${(total / 1024 / 1024).toFixed(2)}MB total\n`,
  );
}

const countries = await buildCountries();
await buildPhysical();
await buildLand();
await buildIce();
await buildPlaces();
await buildCoastline();
await buildRegions(countries);

process.stdout.write('Geographic data rebuilt.\n');
