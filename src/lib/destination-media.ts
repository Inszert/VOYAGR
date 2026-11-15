import manifest from '../../public/img/destinations/manifest.json';
import { findCountry, findCountryByIso2 } from '@/discovery/countries';
import { resolveDestinationGeo } from '@/search/destination-names';

/**
 * What the site already ships for a destination, and what a country is called.
 *
 * The generated set under `public/img/destinations` covers a handful of
 * airports. For those the card and the destination header read the same files
 * and the same blur placeholder, so a place looks like one place wherever it
 * appears. For every other airport the caller falls back to the imagery
 * provider's picture, and then to a plain tile.
 */

interface ManifestEntry {
  readonly width: number;
  readonly height: number;
  readonly blur: string;
}

const ENTRIES = manifest as unknown as Record<string, ManifestEntry>;

export interface LocalDestinationImage {
  readonly width: number;
  readonly height: number;
  readonly blur: string;
  readonly avif: string;
  readonly webp: string;
  readonly fallback: string;
}

function set(code: string, extension: 'avif' | 'webp'): string {
  return [480, 768, 1024]
    .map((width) => `/img/destinations/${code}-${width}.${extension} ${width}w`)
    .join(', ');
}

export function localDestinationImage(code: string): LocalDestinationImage | null {
  const key = code.toUpperCase();
  const entry = ENTRIES[key];
  if (!entry) return null;

  return {
    width: entry.width,
    height: entry.height,
    blur: entry.blur,
    avif: set(key, 'avif'),
    webp: set(key, 'webp'),
    fallback: `/img/destinations/${key}-768.webp`,
  };
}

/** A country, spelled out: "Malta", never "MT". Null when nothing names it. */
export function countryNameFor(code: string): string | null {
  const place = resolveDestinationGeo(code.toUpperCase());
  if (!place) return null;

  const byAdm0 = place.adm0 ? findCountry(place.adm0) : null;
  if (byAdm0) return byAdm0.name;

  if (/^[A-Za-z]{2}$/.test(place.country)) {
    return findCountryByIso2(place.country)?.name ?? null;
  }

  return place.country || null;
}
