/**
 * Generate the PWA icon set.
 *
 * Writes real PNGs with no image-library dependency: pixels are composed by
 * hand, then deflated and framed as a minimal PNG. Checked-in binaries are
 * usually opaque, so this script exists to make them reproducible - re-running it
 * yields byte-identical files.
 *
 * The mark is a simple paper-plane triangle on the brand blue. It is placeholder
 * branding, deliberately plain, to be replaced by a designed asset.
 *
 * Usage: npm run icons:generate
 */

import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = join(__dirname, '..', 'public', 'icons');

/** Brand blue, matching --color-brand-700 in globals.css. */
const BACKGROUND = [28, 79, 124];
const FOREGROUND = [255, 255, 255];

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let crc = -1;
  for (const byte of buffer) {
    crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ byte) & 0xff];
  }
  return (crc ^ -1) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);

  const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data]);

  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData), 0);

  return Buffer.concat([length, typeAndData, crc]);
}

/** Encode raw RGB rows into a PNG buffer. */
function encodePng(width, height, pixels) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.writeUInt8(8, 8); // bit depth
  ihdr.writeUInt8(2, 9); // colour type 2 = truecolour RGB
  ihdr.writeUInt8(0, 10); // compression
  ihdr.writeUInt8(0, 11); // filter
  ihdr.writeUInt8(0, 12); // interlace

  // Each scanline is prefixed with filter type 0 (None).
  const stride = width * 3;
  const raw = Buffer.alloc((stride + 1) * height);

  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0;
    pixels.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/**
 * Draw the mark.
 *
 * @param size - square edge length in pixels.
 * @param safeZone - fraction of the canvas the glyph is inset by. Maskable
 *   icons need a larger inset so a circular launcher mask cannot clip the mark.
 */
function drawIcon(size, safeZone) {
  const pixels = Buffer.alloc(size * size * 3);

  // Fill the background.
  for (let index = 0; index < size * size; index += 1) {
    pixels[index * 3] = BACKGROUND[0];
    pixels[index * 3 + 1] = BACKGROUND[1];
    pixels[index * 3 + 2] = BACKGROUND[2];
  }

  // A rightward-pointing triangle, centred, inset by the safe zone.
  const inset = size * safeZone;
  const left = inset;
  const right = size - inset;
  const top = inset;
  const bottom = size - inset;
  const midY = size / 2;

  for (let y = Math.floor(top); y < Math.ceil(bottom); y += 1) {
    // Half-width of the triangle at this row, tapering to a point on the right.
    const distanceFromMid = Math.abs(y - midY);
    const rowRight = right - (distanceFromMid / (midY - top)) * (right - left);

    for (let x = Math.floor(left); x < rowRight; x += 1) {
      // Notch the tail so the shape reads as a plane rather than a triangle.
      const notchWidth = (right - left) * 0.28;
      if (x < left + notchWidth && distanceFromMid < notchWidth * 0.55) continue;

      const index = (y * size + x) * 3;
      pixels[index] = FOREGROUND[0];
      pixels[index + 1] = FOREGROUND[1];
      pixels[index + 2] = FOREGROUND[2];
    }
  }

  return encodePng(size, size, pixels);
}

mkdirSync(OUTPUT_DIR, { recursive: true });

const outputs = [
  ['icon-192.png', drawIcon(192, 0.22)],
  ['icon-512.png', drawIcon(512, 0.22)],
  // Maskable: 40% inset keeps the glyph well inside the 80% safe circle.
  ['icon-maskable-512.png', drawIcon(512, 0.3)],
];

for (const [name, buffer] of outputs) {
  const path = join(OUTPUT_DIR, name);
  writeFileSync(path, buffer);
  console.log(`wrote ${path} (${buffer.length} bytes)`);
}
