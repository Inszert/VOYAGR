import { z } from 'zod';
import raw from './emergency.generated.json';

/**
 * Emergency numbers by country.
 *
 * The data is `emergency.generated.json`, written by
 * `scripts/build-emergency.mjs` from Wikidata (CC0) and never edited by hand.
 * It is schema-checked here at load, the same as any other outside data: a
 * malformed file means no data, not a crash and not a guess.
 *
 * **A country we have no number for returns `null`.** There is no fallback to
 * 112 or 911 - those are right in a lot of places and dangerously wrong in the
 * rest, and a number shown with confidence is a number somebody dials. The page
 * says "No verified number on file" instead.
 */

const DatasetSchema = z.object({
  source: z.object({
    name: z.string().min(1),
    url: z.url(),
    property: z.string().min(1),
    license: z.string().min(1),
    retrievedOn: z.iso.date(),
  }),
  countries: z.record(
    z.string().regex(/^[A-Z]{2}$/),
    z.object({ numbers: z.array(z.string().regex(/^\+?[0-9][0-9 -]*$/)).min(1) }),
  ),
});

export type EmergencyDataset = z.infer<typeof DatasetSchema>;

export interface EmergencyInfo {
  /** Dialable numbers Wikidata lists for the country. Which service each reaches is not stated. */
  readonly numbers: readonly string[];
  readonly source: {
    readonly name: string;
    readonly url: string;
    readonly license: string;
    readonly retrievedOn: string;
  };
}

/** The dataset, or `null` when it is absent or does not match the schema. */
export function parseEmergencyDataset(value: unknown): EmergencyDataset | null {
  const parsed = DatasetSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

const dataset: EmergencyDataset | null = parseEmergencyDataset(raw);

/** Emergency numbers for an ISO 3166-1 alpha-2 country code, or `null` if none are on file. */
export function emergencyInfoFor(
  iso2: string | null | undefined,
  data: EmergencyDataset | null = dataset,
): EmergencyInfo | null {
  if (!iso2 || !data) return null;

  const entry = data.countries[iso2.toUpperCase()];
  if (!entry) return null;

  const { name, url, license, retrievedOn } = data.source;
  return { numbers: entry.numbers, source: { name, url, license, retrievedOn } };
}
