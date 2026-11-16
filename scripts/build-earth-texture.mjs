/**
 * The planet's surface, as raster tiles on our own origin - one set per month.
 *
 * The globe shows the *season* of the month somebody is travelling in, not
 * the weather: Slovakia in January has snow on it, Italy in July is dry and
 * warm, and neither is a forecast. NASA's Blue Marble Next Generation is a
 * cloud-free composite for each month of 2004, with topography and bathymetry,
 * so its twelve images carry seasonal snow cover and vegetation as they
 * actually were in a typical year. It is public domain. The topography and
 * bathymetry variant shades the sea floor instead of sea ice, so the oceans -
 * and the two polar caps `globe-style.ts` paints past 85 degrees - are the same
 * colour in every month; only the land changes with the season.
 *
 * **It runs here, not in a browser.** Each 5400x2700 equirectangular image is
 * fetched once into the git-ignored `.geo-cache/`, reprojected to Web
 * Mercator - which is what MapLibre's globe draws raster tiles in - and cut
 * into 256px WebP tiles for zoom 0 to 4 under `public/geo/earth/v2/<MM>/`.
 * Only the tiles are committed. Nothing reaches NASA at runtime, which is the
 * property `docs/map-options.md` exists to protect.
 *
 * **Budget.** Twelve pyramids must stay under about 14 MB together, and a
 * visit only ever fetches one of them. The script prints each month's size and
 * the total, and fails if the total passes the budget.
 *
 * **Immutable.** The service worker serves `/geo/` cache-first and forever. A
 * month that already exists is skipped, never rewritten; a rebuild with
 * different settings goes into `v3`. `v1` (August only) stays on disk until
 * nothing points at it.
 *
 *   node scripts/build-earth-texture.mjs            # every month not yet built
 *   node scripts/build-earth-texture.mjs 01 07      # just these
 */

import { mkdir, readdir, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import sharp from 'sharp';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const CACHE = join(ROOT, '.geo-cache');
const VERSION = 'v2';
const OUT = join(ROOT, 'public', 'geo', 'earth', VERSION);

const MONTHS = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
];

/** NASA Earth Observatory, Blue Marble Next Generation, 2004, topography and bathymetry. */
function sourceUrl(index) {
  const mm = String(index + 1).padStart(2, '0');
  return `https://assets.science.nasa.gov/content/dam/science/esd/eo/images/bmng/bmng-topography-bathymetry/${MONTHS[index]}/world.topo.bathy.2004${mm}.3x5400x2700.jpg`;
}

function sourceFile(index) {
  const mm = String(index + 1).padStart(2, '0');
  return join(CACHE, `bmng-topo-bathy-2004${mm}-5400x2700.jpg`);
}

const MAX_ZOOM = 4;
const TILE = 256;
/** Lower than v1's 78: twelve pyramids have to fit where one used to. */
const QUALITY = 72;
const MAX_LAT = 85.0511287798;
const BUDGET_BYTES = 14 * 1024 * 1024;

async function fetchSource(index) {
  const file = sourceFile(index);
  if (existsSync(file)) return;
  await mkdir(CACHE, { recursive: true });
  const url = sourceUrl(index);
  console.log(`fetching ${url}`);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${response.status} fetching ${url}`);
  await writeFile(file, Buffer.from(await response.arrayBuffer()));
}

/** Equirectangular -> Web Mercator, bilinear, one mosaic at the top zoom. */
async function mercatorMosaic(file) {
  const { data, info } = await sharp(file).removeAlpha().raw().toBuffer({
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

async function sizeOf(directory) {
  let total = 0;
  for (const entry of await readdir(directory, { withFileTypes: true, recursive: true })) {
    if (entry.isFile()) total += (await stat(join(entry.parentPath, entry.name))).size;
  }
  return total;
}

async function buildMonth(index) {
  const mm = String(index + 1).padStart(2, '0');
  const out = join(OUT, mm);

  // Immutable: a month that exists is never rewritten (see the header).
  if (existsSync(out)) {
    console.log(`${mm}: exists, skipped`);
    return;
  }

  await fetchSource(index);
  const { buffer, size } = await mercatorMosaic(sourceFile(index));

  for (let z = 0; z <= MAX_ZOOM; z += 1) {
    const side = TILE * 2 ** z;
    // Area-averaged down from the top zoom, so a low zoom is not aliased.
    const level = await sharp(buffer, { raw: { width: size, height: size, channels: 3 } })
      .resize(side, side, { kernel: 'lanczos3' })
      .raw()
      .toBuffer();

    for (let x = 0; x < 2 ** z; x += 1) {
      await mkdir(join(out, String(z), String(x)), { recursive: true });

      for (let y = 0; y < 2 ** z; y += 1) {
        await sharp(level, { raw: { width: side, height: side, channels: 3 } })
          .extract({ left: x * TILE, top: y * TILE, width: TILE, height: TILE })
          .webp({ quality: QUALITY, effort: 6 })
          .toFile(join(out, String(z), String(x), `${y}.webp`));
      }
    }
  }

  console.log(`${mm}: ${((await sizeOf(out)) / 1024 / 1024).toFixed(2)} MB`);
}

async function main() {
  const wanted = process.argv.slice(2);
  const indices = wanted.length
    ? wanted.map((value) => Number.parseInt(value, 10) - 1)
    : MONTHS.map((_month, index) => index);

  const failed = [];
  for (const index of indices) {
    try {
      await buildMonth(index);
    } catch (error) {
      failed.push(`${sourceUrl(index)} (${error.message})`);
    }
  }

  if (failed.length) {
    console.error(`could not build:\n  ${failed.join('\n  ')}`);
    process.exitCode = 1;
  }

  if (existsSync(OUT)) {
    const total = await sizeOf(OUT);
    console.log(`total ${(total / 1024 / 1024).toFixed(2)} MB -> ${OUT}`);
    if (total > BUDGET_BYTES) {
      console.error(`over the ${(BUDGET_BYTES / 1024 / 1024).toFixed(0)} MB budget`);
      process.exitCode = 1;
    }
  }
}

await main();
