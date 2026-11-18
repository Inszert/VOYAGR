import { z } from 'zod';
import { PART_WEIGHT_PARAMS } from '@/search/part-weight-params';

/**
 * The explore choices a visitor keeps between visits.
 *
 * A per-viewer convenience, so every call here tolerates a storage that is missing, blocked or
 * full: it returns null or does nothing, and never throws. Anything stored that does not match
 * the schema is ignored. The dates are deliberately not part of this - they change too often.
 */

export const PREFERENCES_KEY = 'voyagr.explore.prefs.v1';

/** The storage surface this module needs; the browser's `localStorage` fits it. */
export interface PreferenceStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** URL parameters for the result filters that are kept. `fDates` and `fDest` pick one search. */
export const REMEMBERED_FILTER_PARAMS = [
  'fMaxTotal',
  'fMinTotal',
  'fDirect',
  'fMaxStops',
  'fDepartAfter',
  'fDepartBefore',
  'fReturnAfter',
  'fReturnBefore',
  'fArriveBefore',
  'fFreeCancel',
  'fMinReview',
  'fNoSelfTransfer',
  'fTransferPriced',
  'fSort',
] as const;

const WEIGHT_PARAMS = Object.values(PART_WEIGHT_PARAMS) as string[];
const FILTER_PARAMS = REMEMBERED_FILTER_PARAMS as readonly string[];

const AIRPORT = /^[A-Z]{3}$/;
const DESTINATION = /^(anywhere|[A-Za-z]{3}(\s*,\s*[A-Za-z]{3}){0,19})$/i;

const shortValue = z.string().min(1).max(40);

function recordOf(allowed: readonly string[]) {
  return z
    .record(z.string(), shortValue)
    .refine((rec) => Object.keys(rec).every((k) => allowed.includes(k)));
}

export const preferencesSchema = z.object({
  origins: z.array(z.string().regex(AIRPORT)).min(1).max(5),
  destinations: z.string().max(200).regex(DESTINATION).optional(),
  passengers: z.number().int().min(1).max(9).optional(),
  flexibility: z
    .string()
    .regex(/^[a-z-]{1,20}$/)
    .optional(),
  weights: recordOf(WEIGHT_PARAMS),
  filters: recordOf(FILTER_PARAMS),
});

export type ExplorePreferences = z.infer<typeof preferencesSchema>;

export function readPreferences(
  storage: PreferenceStorage | null | undefined,
): ExplorePreferences | null {
  try {
    if (!storage) return null;
    const raw = storage.getItem(PREFERENCES_KEY);
    if (raw === null) return null;
    const parsed = preferencesSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function writePreferences(
  storage: PreferenceStorage | null | undefined,
  prefs: ExplorePreferences,
): void {
  try {
    if (!storage) return;
    const checked = preferencesSchema.safeParse(prefs);
    if (!checked.success) return;
    storage.setItem(PREFERENCES_KEY, JSON.stringify(checked.data));
  } catch {
    // Blocked or full: the page works without it.
  }
}

export function clearPreferences(storage: PreferenceStorage | null | undefined): void {
  try {
    storage?.removeItem(PREFERENCES_KEY);
  } catch {
    // Nothing to clear if storage is blocked.
  }
}

/** Every URL parameter that belongs to the remembered set, for removal on "forget". */
export const REMEMBERED_PARAMS: readonly string[] = [
  'origins',
  'destinations',
  'passengers',
  'flexibility',
  ...WEIGHT_PARAMS,
  ...FILTER_PARAMS,
];

/** The remembered subset of a URL's parameters, or null when there is no search to remember. */
export function preferencesFromParams(params: URLSearchParams): ExplorePreferences | null {
  const origins = (params.get('origins') ?? '')
    .split(/[,\s]+/)
    .map((code) => code.toUpperCase())
    .filter(Boolean)
    .slice(0, 5);

  const pick = (allowed: readonly string[]) => {
    const out: Record<string, string> = {};
    for (const key of allowed) {
      const value = params.get(key);
      if (value !== null && value !== '') out[key] = value;
    }
    return out;
  };

  const passengers = Number(params.get('passengers'));
  const candidate = {
    origins,
    destinations: params.get('destinations')?.trim() || undefined,
    passengers: Number.isInteger(passengers) && passengers > 0 ? passengers : undefined,
    flexibility: params.get('flexibility') || undefined,
    weights: pick(WEIGHT_PARAMS),
    filters: pick(FILTER_PARAMS),
  };

  const parsed = preferencesSchema.safeParse(candidate);
  if (parsed.success) return parsed.data;

  // One bad optional field should not lose the rest: retry with only the origins.
  const minimal = preferencesSchema.safeParse({ origins, weights: {}, filters: {} });
  return minimal.success ? minimal.data : null;
}

/** The URL parameters a remembered choice stands for. */
export function paramsFromPreferences(prefs: ExplorePreferences): URLSearchParams {
  const params = new URLSearchParams();
  params.set('origins', prefs.origins.join(', '));
  if (prefs.destinations) params.set('destinations', prefs.destinations);
  if (prefs.passengers !== undefined) params.set('passengers', String(prefs.passengers));
  if (prefs.flexibility) params.set('flexibility', prefs.flexibility);
  for (const [key, value] of Object.entries(prefs.weights)) params.set(key, value);
  for (const [key, value] of Object.entries(prefs.filters)) params.set(key, value);
  return params;
}

// --- Trips kept in this browser ------------------------------------------------------

export const SAVED_TRIPS_KEY = 'voyagr.saved-trips.v1';
const MAX_SAVED_TRIPS = 20;

/** A trip a signed-out visitor kept here until they sign in. Words and dates only: no price. */
export const savedTripSchema = z.object({
  name: z.string().min(1).max(80),
  destination: z.string().min(1).max(80),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  /** The explorer address that reopens it. */
  href: z
    .string()
    .max(2000)
    .regex(/^\/explore(\?\S*)?$/),
});

export type BrowserSavedTrip = z.infer<typeof savedTripSchema>;

export function readSavedTrips(
  storage: PreferenceStorage | null | undefined,
): readonly BrowserSavedTrip[] {
  try {
    if (!storage) return [];
    const raw = storage.getItem(SAVED_TRIPS_KEY);
    if (raw === null) return [];
    const parsed = z.array(savedTripSchema).safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : [];
  } catch {
    return [];
  }
}

/** Keeps the trip (replacing one at the same address). Returns false when it could not be kept. */
export function saveTripToBrowser(
  storage: PreferenceStorage | null | undefined,
  trip: BrowserSavedTrip,
): boolean {
  try {
    if (!storage) return false;
    const checked = savedTripSchema.safeParse(trip);
    if (!checked.success) return false;
    const rest = readSavedTrips(storage).filter((entry) => entry.href !== checked.data.href);
    storage.setItem(
      SAVED_TRIPS_KEY,
      JSON.stringify([checked.data, ...rest].slice(0, MAX_SAVED_TRIPS)),
    );
    return true;
  } catch {
    return false;
  }
}
