/**
 * The planet's surface, as raster tiles on our own origin.
 *
 * The vector globe drew every continent as one flat fill, which reads as a
 * diagram. NASA's Blue Marble Next Generation with topography and bathymetry
 * is the opposite: relief under the forests and deserts, shelves and trenches
 * under the sea, and ice. It is public domain.
 *
 * **It runs here, not in a browser.** The 5400x2700 equirectangular image is
 * fetched once into the git-ignored `.geo-cache/` (like the Natural Earth
 * downloads), reprojected to Web Mercator - which is what MapLibre's globe
 * draws raster tiles in - and cut into 256px WebP tiles for zoom 0 to 4. Only
 * the tiles are committed. Nothing reaches NASA at runtime, which is the
 * property `docs/map-options.md` exists to protect.
 *
 * **Immutable.** The service worker serves `/geo/` cache-first and forever, so
 * a rebuild goes into a new `v2`, `v3`... directory and the style points at
 * it. Never rewrite `v1` in place.
 *
 *   node scripts/build-earth-texture.mjs
 */

import { mkdir, rm, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import sharp from 'sharp';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const CACHE = join(ROOT, '.geo-cache');
const SOURCE_FILE = join(CACHE, 'bmng-topo-bathy-200408-5400x2700.jpg');
const OUT = join(ROOT, 'public', 'geo', 'earth', 'v1');

/** NASA Earth Observatory, Blue Marble Next Generation, August 2004, topography and bathymetry. */
const SOURCE =
  'https://assets.science.nasa.gov/content/dam/science/esd/eo/images/bmng/bmng-topography-bathymetry/august/world.topo.bathy.200408.3x5400x2700.jpg';

const MAX_ZOOM = 4;
const TILE = 256;
const QUALITY = 78;
const MAX_LAT = 85.0511287798;

async function fetchSource() {
  if (existsSync(SOURCE_FILE)) return;
  await mkdir(CACHE, { recursive: true });
  console.log(`fetching ${SOURCE}`);
  const response = await fetch(SOURCE);
  if (!response.ok) throw new Error(`${response.status} fetching ${SOURCE}`);
  await writeFile(SOURCE_FILE, Buffer.from(await response.arrayBuffer()));
}

/** Equirectangular -> Web Mercator, bilinear, one mosaic at the top zoom. */
async function mercatorMosaic() {
  const { data, info } = await sharp(SOURCE_FILE).removeAlpha().raw().toBuffer({
    resolveWithObject: true,
  });
  const { width: sw, height: sh } = info;
  const size = TILE * 2 ** MAX_ZOOM;
  const out = Buffer.alloc(size * size * 3);

  for (let y = 0; y < size; y += 1) {
    // Inverse Mercator: the latitude this row of the tile pyramid sits at.
    const n = Math.PI * (1 - (2 * (y + 0.5)) / size);
    const lat = (Math.atan(Math.sinh(n)) * 180) / Math.PI;
    const fy = ((90 - Math.max(-MAX_LAT, Math.min(MAX_LAT, lat))) / 180) * sh - 0.5;
    const y0 = Math.max(0, Math.min(sh - 1, Math.floor(fy)));
    const y1 = Math.min(sh - 1, y0 + 1);
    const ty = Math.max(0, Math.min(1, fy - y0));

    for (let x = 0; x < size; x += 1) {
      const fx = ((x + 0.5) / size) * sw - 0.5;
      const x0 = Math.floor(fx);
      const tx = fx - x0;
      const xa = (x0 + sw) % sw;
      const xb = (x0 + 1 + sw) % sw;

      for (let c = 0; c < 3; c += 1) {
        const top = data[(y0 * sw + xa) * 3 + c] * (1 - tx) + data[(y0 * sw + xb) * 3 + c] * tx;
        const bottom = data[(y1 * sw + xa) * 3 + c] * (1 - tx) + data[(y1 * sw + xb) * 3 + c] * tx;
        out[(y * size + x) * 3 + c] = Math.round(top * (1 - ty) + bottom * ty);
      }
    }
  }

  return { buffer: out, size };
}

async function main() {
  await fetchSource();
  const { buffer, size } = await mercatorMosaic();

  // v1 is built once. A rebuild is v2, because browsers keep v1 for ever.
  await rm(OUT, { recursive: true, force: true });

  let total = 0;
  let tiles = 0;

  for (let z = 0; z <= MAX_ZOOM; z += 1) {
    const side = TILE * 2 ** z;
    // Area-averaged down from the top zoom, so a low zoom is not aliased.
    const level = await sharp(buffer, { raw: { width: size, height: size, channels: 3 } })
      .resize(side, side, { kernel: 'lanczos3' })
      .raw()
      .toBuffer();

    for (let x = 0; x < 2 ** z; x += 1) {
      await mkdir(join(OUT, String(z), String(x)), { recursive: true });

      for (let y = 0; y < 2 ** z; y += 1) {
        const file = join(OUT, String(z), String(x), `${y}.webp`);
        await sharp(level, { raw: { width: side, height: side, channels: 3 } })
          .extract({ left: x * TILE, top: y * TILE, width: TILE, height: TILE })
          .webp({ quality: QUALITY, effort: 5 })
          .toFile(file);

        total += (await stat(file)).size;
        tiles += 1;
      }
    }
  }

  console.log(`${tiles} tiles, ${(total / 1024 / 1024).toFixed(2)} MB -> ${OUT}`);
}

await main();
