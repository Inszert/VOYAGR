#!/usr/bin/env node
import { copyFile, mkdir, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

/**
 * Put MapLibre's worker where the browser can find it.
 *
 * MapLibre resolves its worker relative to `import.meta.url`, expecting the
 * package layout it ships with. After bundling, `import.meta.url` is a hashed
 * Next chunk, so it asks for `/_next/static/chunks/maplibre-gl-worker.mjs` -
 * which does not exist. The map then renders its background, reports no error
 * and silently never loads a source, which is a remarkably quiet way to fail.
 *
 * So the worker is served from our own origin and pointed at explicitly. The
 * files are copied rather than committed: a 500KB build artifact checked into
 * the repository would drift from the library it came out of, and the drift
 * would show up as the same silent blank map.
 *
 * Both files are needed - the worker is an ES module that imports the shared
 * chunk beside it - and they must keep their names, because that import is by
 * filename.
 */

const FILES = ['maplibre-gl-worker.mjs', 'maplibre-gl-shared.mjs'];
const DESTINATION = 'public/maplibre';

const require = createRequire(import.meta.url);
const distributionDirectory = dirname(require.resolve('maplibre-gl/dist/maplibre-gl.mjs'));

await mkdir(DESTINATION, { recursive: true });

for (const file of FILES) {
  await copyFile(join(distributionDirectory, file), join(DESTINATION, file));
}

const { version } = JSON.parse(await readFile(require.resolve('maplibre-gl/package.json'), 'utf8'));

process.stdout.write(`Copied the MapLibre ${version} worker into ${DESTINATION}/\n`);
