import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { LAUNCH_DESTINATIONS } from '@/liteapi-snapshot/targets';

/** The cities the stored snapshot covers, for the start page's city cards. */
export interface CoveredCity {
  readonly code: string;
  readonly name: string;
  /** `/img/destinations/<code>-768.webp`, or null when the city has no photo. */
  readonly photo: string | null;
  readonly width: number | null;
  readonly height: number | null;
}

interface ManifestEntry {
  readonly width?: number;
  readonly height?: number;
}

function readManifest(path: string): Record<string, ManifestEntry> {
  try {
    if (!existsSync(path)) return {};
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, ManifestEntry>) : {};
  } catch {
    return {};
  }
}

export function coveredCities(
  manifestPath: string = join(process.cwd(), 'public', 'img', 'destinations', 'manifest.json'),
): CoveredCity[] {
  const manifest = readManifest(manifestPath);
  return LAUNCH_DESTINATIONS.map((destination) => {
    const entry = Object.prototype.hasOwnProperty.call(manifest, destination.code)
      ? manifest[destination.code]
      : undefined;
    return {
      code: destination.code,
      name: destination.name,
      photo: entry ? `/img/destinations/${destination.code}-768.webp` : null,
      width: entry?.width ?? null,
      height: entry?.height ?? null,
    };
  });
}
