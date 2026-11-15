import { localDestinationImage, countryNameFor } from '@/lib/destination-media';
import { imageryCodeForPlace } from '@/providers/imagery';
import { resolveDestinationNames } from '@/search/destination-names';
import manifest from '../../public/img/destinations/manifest.json';

/**
 * Which of the pictures we ship belongs to a place somebody typed.
 *
 * A trip's destination is free text ("Lisbon", "Faro, Algarve") and a watch's
 * is an airport code. Only the airports in the generated set have a picture, and
 * the answer for everywhere else is `null` - the caller draws an initials tile,
 * never a picture of somewhere else. Matching is exact on a city name, never
 * fuzzy: a wrong photograph is a claim about the place.
 */

export interface PlacePictureData {
  readonly code: string;
  readonly blur: string;
  /** "Lisbon, Portugal": what the picture is of, in full. */
  readonly label: string;
}

const LOCAL_CODES = Object.keys(manifest as Record<string, unknown>);

function describe(code: string, city: string | null): PlacePictureData | null {
  const image = localDestinationImage(code);
  if (!image) return null;

  const country = countryNameFor(code);
  return { code, blur: image.blur, label: [city, country].filter(Boolean).join(', ') || code };
}

/** By airport code, when the code has a picture. */
export function placePictureForCode(code: string): PlacePictureData | null {
  const upper = code.toUpperCase();
  return describe(upper, resolveDestinationNames([upper])[upper] ?? null);
}

/** By the words a person used for the place, optionally helped by a code. */
export function placePictureForText(text: string, code?: string | null): PlacePictureData | null {
  if (code) {
    const byCode = placePictureForCode(code);
    if (byCode) return byCode;
  }

  const wanted = text.split(',')[0]!.trim().toLowerCase();
  if (wanted === '') return null;

  const names = resolveDestinationNames(LOCAL_CODES);
  const exact = LOCAL_CODES.find((candidate) => names[candidate]?.toLowerCase() === wanted);
  if (exact) return describe(exact, names[exact] ?? null);

  const viaCatalogue = imageryCodeForPlace(wanted);
  return viaCatalogue ? placePictureForCode(viaCatalogue) : null;
}
