/**
 * Exports the destination masters in `assets/destination-masters/` to
 * `public/img/destinations/` as AVIF and WebP at 480, 768 and 1024 px, plus a
 * manifest of intrinsic sizes and blur placeholders.
 *
 *   node scripts/export-destination-images.mjs
 *
 * The masters are AI-generated illustrations (see docs/design-direction.md,
 * section 6). Widths never exceed the master's own width.
 */
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import sharp from 'sharp';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const sourceDir = path.join(root, 'assets', 'destination-masters');
const outDir = path.join(root, 'public', 'img', 'destinations');
const WIDTHS = [480, 768, 1024];

mkdirSync(outDir, { recursive: true });
const manifest = {};

for (const file of readdirSync(sourceDir)
  .filter((name) => name.endsWith('.png'))
  .sort()) {
  const code = path.basename(file, '.png');
  const source = path.join(sourceDir, file);
  const meta = await sharp(source).metadata();
  for (const width of WIDTHS) {
    const resized = sharp(source).resize({ width: Math.min(width, meta.width) });
    await resized
      .clone()
      .avif({ quality: 55 })
      .toFile(path.join(outDir, `${code}-${width}.avif`));
    await resized
      .clone()
      .webp({ quality: 74 })
      .toFile(path.join(outDir, `${code}-${width}.webp`));
  }
  const blur = await sharp(source).resize(24).webp({ quality: 40 }).toBuffer();
  manifest[code] = {
    width: meta.width,
    height: meta.height,
    blur: `data:image/webp;base64,${blur.toString('base64')}`,
  };
}

writeFileSync(path.join(outDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
