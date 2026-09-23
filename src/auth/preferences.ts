import { z } from 'zod';
import { OPTIMISATION_MODES, TRAVEL_STYLES } from '@/search/schema';
import type { UserPreferencesRecord } from '@/db/repository';

/**
 * Explicit travel preferences (specification section 31.7).
 *
 * These are the defaults a user set deliberately: their home airports, their
 * usual party size, what they optimise for. They pre-fill the search form and
 * nothing more - a preference is a starting point, never a hidden filter that
 * quietly removes results the user never asked to lose.
 *
 * Kept strictly apart from inferred preferences at the schema level. Section
 * 31.7 requires a user to be able to see what the system believes about them
 * and where each belief came from, and that is only answerable if "you told us"
 * and "we guessed" were never mixed into one blob.
 */

export const explicitPreferencesSchema = z.object({
  homeAirports: z
    .array(z.string().regex(/^[A-Z]{3}$/))
    .max(6)
    .optional(),
  currency: z
    .string()
    .regex(/^[A-Z]{3}$/)
    .optional(),
  defaultPassengers: z.number().int().min(1).max(9).optional(),
  travelStyle: z.enum(TRAVEL_STYLES).optional(),
  optimisationMode: z.enum(OPTIMISATION_MODES).optional(),
  requireDirectFlights: z.boolean().optional(),
  requireCheckedBaggage: z.boolean().optional(),
  requireFreeCancellation: z.boolean().optional(),
  /**
   * The smallest saving worth an alert, in whole units of a watch's own
   * currency. Only ever raises the product's bar; see `clearsPersonalThreshold`.
   */
  alertMinimumSaving: z.number().int().min(0).max(100_000).optional(),
});

export type ExplicitPreferences = z.infer<typeof explicitPreferencesSchema>;

/**
 * Read stored preferences, discarding anything that no longer validates.
 *
 * Stored JSON outlives the code that wrote it. A field removed in a later
 * release, or written by an older one, must not break the account page, so a
 * value that fails validation is dropped rather than thrown over.
 */
export function readExplicitPreferences(record: UserPreferencesRecord | null): ExplicitPreferences {
  if (!record) return {};

  const parsed = explicitPreferencesSchema.safeParse(record.explicit);
  return parsed.success ? parsed.data : {};
}

/**
 * What the system has inferred, as label and value pairs for display.
 *
 * Nothing writes inferred preferences yet - that arrives with Phase 3's travel
 * profile. The reader exists now so the account page can already answer "what
 * do you think you know about me?" with an honest "nothing yet" rather than
 * with silence.
 */
export function readInferredPreferences(
  record: UserPreferencesRecord | null,
): Array<{ key: string; value: string }> {
  if (!record) return [];

  return Object.entries(record.inferred).map(([key, value]) => ({
    key,
    value: typeof value === 'string' ? value : JSON.stringify(value),
  }));
}

/**
 * Turn stored preferences into search-form defaults.
 *
 * This is what makes a saved preference mean anything: without it the account
 * page would promise to pre-fill a search and quietly not. Values are strings
 * because that is what a form field holds, and a checkbox is `'on'` or absent
 * for the same reason.
 *
 * Defaults only. A preference never filters, narrows or overrides what the user
 * typed into the search in front of them.
 */
export function preferencesToFormDefaults(
  preferences: ExplicitPreferences,
): Record<string, string> {
  const defaults: Record<string, string> = {};

  if (preferences.homeAirports?.length) defaults.origins = preferences.homeAirports.join(', ');
  if (preferences.currency) defaults.currency = preferences.currency;
  if (preferences.defaultPassengers) {
    defaults.passengers = String(preferences.defaultPassengers);
  }
  if (preferences.travelStyle) defaults.travelStyle = preferences.travelStyle;
  if (preferences.optimisationMode) defaults.optimisationMode = preferences.optimisationMode;

  // An unchecked box submits nothing, so only a true preference is written.
  if (preferences.requireDirectFlights) defaults.requireDirectFlights = 'on';
  if (preferences.requireCheckedBaggage) defaults.requireCheckedBaggage = 'on';
  if (preferences.requireFreeCancellation) defaults.requireFreeCancellation = 'on';

  return defaults;
}
