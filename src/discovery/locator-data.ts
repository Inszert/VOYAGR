import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { LAND_URL, PLACES_URL } from './stage-data';
import { buildLocator, type LngLat, type LocatorMap, type LocatorPlace } from './locator';

/**
 * The locator map's data: the loader, and the only part of it that does I/O.
 *
 * Reads the same versioned Natural Earth files the globe draws from, off the
 * server's own disk rather than over HTTP, and keeps them for the life of the
 * process: they are immutable by URL (`geo-files-are-immutable`), so there is
 * nothing to invalidate. A missing or unreadable file is no map, never an
 * error page - the page around it says where the place is in words.
 */

type Ring = readonly (readonly [number, number])[];

let cached: Promise<{ land: Ring[]; places: LocatorPlace[] } | null> | null = null;

async function readGeo(url: string): Promise<unknown> {
  return JSON.parse(await readFile(join(process.cwd(), 'public', url), 'utf8'));
}

function load() {
  cached ??= (async () => {
    try {
      const [landJson, placesJson] = (await Promise.all([
        readGeo(LAND_URL),
        readGeo(PLACES_URL),
      ])) as [
        { features: { geometry: { type: string; coordinates: unknown } }[] },
        {
          features: {
            properties: { name?: string; kind?: string };
            geometry: { coordinates: [number, number] };
          }[];
        },
      ];

      const land: Ring[] = [];
      for (const feature of landJson.features) {
        if (feature.geometry.type === 'Polygon') {
          land.push((feature.geometry.coordinates as Ring[])[0]!);
        } else if (feature.geometry.type === 'MultiPolygon') {
          for (const polygon of feature.geometry.coordinates as Ring[][]) land.push(polygon[0]!);
        }
      }

      const places: LocatorPlace[] = placesJson.features
        .filter((feature) => typeof feature.properties.name === 'string')
        .map((feature) => ({
          name: feature.properties.name!,
          kind: feature.properties.kind ?? 'place',
          position: feature.geometry.coordinates,
        }));

      return { land, places };
    } catch {
      return null;
    }
  })();

  return cached;
}

export async function loadLocator(
  centre: LngLat,
  size: { readonly width: number; readonly height: number },
): Promise<LocatorMap | null> {
  const data = await load();
  if (!data) return null;

  return buildLocator({ centre, width: size.width, height: size.height, ...data });
}
