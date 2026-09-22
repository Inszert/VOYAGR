/**
 * The night side's lights, from NASA's Black Marble.
 *
 * Natural Earth's populated places gave the globe about six hundred dots, and
 * six hundred dots is confetti: the night side of the Earth is not scattered
 * points, it is continuous glow down coastlines and river valleys with dark
 * between. This thresholds the real composite into tens of thousands of
 * points and keeps how bright each one was.
 *
 * **It runs here, not in a browser.** The image is fetched once at build
 * time, cached beside the Natural Earth downloads, and the output is a
 * GeoJSON file committed under `public/geo/` like every other thing the globe
 * draws. Nothing reaches NASA at runtime, which is the property
 * `docs/map-options.md` exists to protect.
 *
 * **The output is bucketed, not one feature per light.** Forty thousand
 * separate Point features is four megabytes of `{"type":"Feature",...}`
 * repeated forty thousand times. Grouping points by intensity into a handful
 * of MultiPoint features costs about half a megabyte instead, and a MapLibre
 * circle layer still draws every coordinate separately while reading the
 * intensity off the feature they share.
 *
 *   node scripts/build-city-lights.mjs
 */

import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import jpeg from 'jpeg-js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const CACHE = join(ROOT, '.geo-cache');
/*
 * The version is part of the name, and it is not decoration.
 *
 * The service worker serves `/geo/` cache-first and forever, on the grounds
 * that a rebuild lands under a new name. Rebuilding v2 in place broke that:
 * every browser that had been to the site kept its own copy of the old,
 * much denser file and no redeploy could reach it. v3 is the thinned one.
 */
const OUT = join(ROOT, 'public', 'geo', 'city-lights.v3.json');

/**
 * NASA Earth Observatory's "Earth at Night 2012" day/night band composite,
 * equirectangular, 3600 x 1800. Public domain; the credit line NASA asks for
 * is recorded in `docs/map-options.md`.
 */
const SOURCE =
  'https://eoimages.gsfc.nasa.gov/images/imagerecords/79000/79765/dnb_land_ocean_ice.2012.3600x1800.jpg';

/** How many lights to keep. The brief's range; the threshold adapts to hit it. */
const TARGET = 30_000;

/**
 * How coarse the grid is, in source pixels.
 *
 * The composite is a tenth of a degree per pixel. Taking the brightest pixel
 * in each 2x2 block halves the resolution to a fifth of a degree - about
 * twenty kilometres - which is finer than anything drawn at globe zoom and
 * removes most of the sensor speckle in one pass.
 */
const BLOCK = 2;

/** Intensity bands within a cell. Fewer than before: the cell carries most of it. */
const BUCKETS = 4;

/**
 * How big a group is, in degrees.
 *
 * **This is not a free choice.** The style works out whether each light is in
 * darkness by computing the sun's elevation from the feature's own `lat` and
 * `lon` - see `solarElevation` in `globe-style.ts`. Grouping by intensity
 * alone gave eight features spread across the whole planet with no position
 * between them, so the expression evaluated against nothing and every light
 * on Earth burned at noon, over the day side, under a veil of bloom.
 *
 * A group therefore has to stand for one place. Two degrees is about seven
 * pixels at the size the globe is drawn, which is far finer than the width of
 * the dusk the lights have to fade across.
 */
const CELL = 3;

/** Below this, a pixel is noise, airglow or a gas flare's halo rather than a light. */
const FLOOR = 24;

/**
 * The closest two lights are allowed to be, in degrees.
 *
 * **This is what stops a conurbation becoming a blob.** `BLOCK` leaves points
 * on a fifth-of-a-degree grid, and a fifth of a degree is about two thirds of
 * a pixel at the size the globe is drawn - so anywhere cities run together,
 * the Ruhr, the Nile delta, the north of India, the eastern seaboard, every
 * dot overlapped its neighbours and the whole region rendered as one flat
 * sheet of amber with no structure in it at all.
 *
 * Three quarters of a degree is about two and a half pixels there, which is
 * wider than a dot and its blur, so lights stay separate and a dense region
 * reads as dense - many lights close together - rather than as a solid mass.
 * Sparse places are untouched: thinning only ever drops a light that had a
 * brighter one right beside it.
 */
const SPACING = 0.75;

async function cached(url, name) {
  await mkdir(CACHE, { recursive: true });
  const file = join(CACHE, name);

  if (existsSync(file)) {
    process.stdout.write(`  cached  ${name}\n`);
    return readFile(file);
  }

  process.stdout.write(`  fetch   ${name}\n`);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} answered ${response.status}`);

  const bytes = Buffer.from(await response.arrayBuffer());
  await writeFile(file, bytes);

  return bytes;
}

/**
 * The brightness of a pixel, 0 to 255.
 *
 * Rec. 601 luma. The composite is close to greyscale where it is lit, so the
 * weighting barely matters - but the ice sheets in it are blue-white and the
 * cities are orange-white, and luma keeps the cities ahead of the ice.
 */
function luma(data, index) {
  return (data[index] * 299 + data[index + 1] * 587 + data[index + 2] * 114) / 1000;
}

async function main() {
  process.stdout.write('Night lights\n');

  const bytes = await cached(SOURCE, 'black-marble-3600x1800.jpg');
  const image = jpeg.decode(bytes, { useTArray: true });

  const { width, height, data } = image;
  process.stdout.write(`  decode  ${width} x ${height}\n`);

  /*
   * One pass over the image, taking the brightest pixel of each block.
   *
   * Latitude and longitude come straight from the block's position, because
   * the composite is a plate carree: x maps linearly onto -180..180 and y onto
   * 90..-90. Nothing here is a projection, which is why there is no library.
   */
  const found = [];

  for (let y = 0; y < height; y += BLOCK) {
    for (let x = 0; x < width; x += BLOCK) {
      let best = 0;

      for (let dy = 0; dy < BLOCK && y + dy < height; dy += 1) {
        for (let dx = 0; dx < BLOCK && x + dx < width; dx += 1) {
          const value = luma(data, ((y + dy) * width + (x + dx)) * 4);
          if (value > best) best = value;
        }
      }

      if (best < FLOOR) continue;

      found.push([x, y, best]);
    }
  }

  process.stdout.write(`  above floor  ${found.length.toLocaleString('en-GB')}\n`);

  // Brightest first, so every later choice keeps the brightest of whatever
  // it is choosing between.
  found.sort((a, b) => b[2] - a[2]);

  /*
   * One light per `SPACING` square, and it is the brightest one there.
   *
   * Nothing is moved and no light is invented - a point is dropped only when
   * a brighter one already sits in the same square. Cities on their own
   * survive whole; the places where lights ran together lose the duplicates
   * that were painting over each other.
   */
  const claimed = new Set();
  const spaced = [];

  for (const point of found) {
    const longitude = (point[0] / width) * 360 - 180;
    const latitude = 90 - (point[1] / height) * 180;
    const key = `${Math.round(longitude / SPACING)}:${Math.round(latitude / SPACING)}`;

    if (claimed.has(key)) continue;

    claimed.add(key);
    spaced.push(point);
  }

  process.stdout.write(`  spaced  ${spaced.length.toLocaleString('en-GB')} at ${SPACING} deg
`);

  // Then take as many as asked for. An adaptive cut rather than a fixed
  // threshold, so the file stays the same size whichever composite it is
  // pointed at.
  const kept = spaced.slice(0, TARGET);
  const dimmest = kept[kept.length - 1][2];
  const brightest = kept[0][2];

  process.stdout.write(
    `  kept    ${kept.length.toLocaleString('en-GB')} (luma ${Math.round(dimmest)}-${Math.round(brightest)})\n`,
  );

  /*
   * Into buckets, and out as MultiPoints.
   *
   * The intensity a feature carries is the middle of its bucket, normalised
   * to 0..1, which is what the style interpolates radius, opacity and warmth
   * against. Coordinates are rounded to two decimals - about a kilometre,
   * far finer than a light is drawn at any zoom this globe reaches - because
   * the sixth decimal place of a threshold is half the file.
   */
  const groups = new Map();
  const span = Math.max(1, brightest - dimmest);

  for (const [x, y, value] of kept) {
    /*
     * A tenth of a degree, which is eleven kilometres and a third of a pixel
     * at the size the globe is drawn. Two decimals cost a quarter of the file
     * for precision nothing can render.
     */
    const longitude = Math.round(((x / width) * 360 - 180) * 10) / 10;
    const latitude = Math.round((90 - (y / height) * 180) * 10) / 10;

    const cellX = Math.floor((longitude + 180) / CELL);
    const cellY = Math.floor((latitude + 90) / CELL);
    const band = Math.min(BUCKETS - 1, Math.floor(((value - dimmest) / span) * BUCKETS));
    const key = `${cellX}:${cellY}:${band}`;

    let group = groups.get(key);

    if (!group) {
      group = {
        // The middle of the cell, and where the sun's elevation gets
        // worked out for every light inside it.
        lon: Math.round((cellX * CELL - 180 + CELL / 2) * 100) / 100,
        lat: Math.round((cellY * CELL - 90 + CELL / 2) * 100) / 100,
        i: Math.round(((band + 0.5) / BUCKETS) * 100) / 100,
        coordinates: [],
      };
      groups.set(key, group);
    }

    group.coordinates.push([longitude, latitude]);
  }

  const features = [...groups.values()].map((group) => ({
    type: 'Feature',
    properties: { lat: group.lat, lon: group.lon, i: group.i },
    geometry: { type: 'MultiPoint', coordinates: group.coordinates },
  }));

  process.stdout.write(`  grouped ${features.length.toLocaleString('en-GB')} cells
`);

  const json = JSON.stringify({ type: 'FeatureCollection', features });

  if (existsSync(OUT) && (await readFile(OUT, 'utf8')) !== json) {
    throw new Error(`${OUT} exists with different content. Bump the version in its name.`);
  }

  await writeFile(OUT, json);

  const digest = createHash('sha256').update(json).digest('hex').slice(0, 12);
  process.stdout.write(
    `  wrote   public/geo/city-lights.v3.json  ${(json.length / 1024).toFixed(0)} KB  ${digest}\n`,
  );
}

await main();
