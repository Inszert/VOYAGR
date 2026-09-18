import { z } from 'zod';
import { fromMajor } from '@/core/money';
import { isIsoDate } from '@/core/dates';
import type { OptimisationMode, SearchProfile, TravelStyle } from '@/core/trip/types';
import { err, ok, type Result } from '@/lib/result';
import type { SearchRequest } from './types';

/**
 * The structured search schema (implementation plan 1.2).
 *
 * Structured input is the foundation and natural language sits on top of it,
 * never underneath: when the AI layer parses "a week somewhere warm in June
 * under 900 euro", it produces *this* shape and this module validates it. A
 * model never hands a `SearchProfile` straight to the engines.
 *
 * Everything here is deterministic. The only numbers it produces are the ones
 * the user typed, converted to `Money` by `fromMajor` rather than by arithmetic
 * on a float.
 */

export const TRAVEL_STYLES = [
  'balanced',
  'full_chill',
  'chill',
  'explore',
  'culture',
  'food',
  'beach',
  'nightlife',
  'adventure',
  'luxury',
] as const satisfies readonly TravelStyle[];

export const OPTIMISATION_MODES = [
  'best_value',
  'cheapest',
  'nicest_within_budget',
  'maximise_beach_time',
  'maximise_hotel_quality',
  'maximise_food_quality',
  'maximise_exploration',
] as const satisfies readonly OptimisationMode[];

/** Human labels, kept beside the values so a form and a summary cannot drift. */
export const TRAVEL_STYLE_LABELS: Record<TravelStyle, string> = {
  balanced: 'Balanced',
  full_chill: 'Total relaxation',
  chill: 'Relaxed',
  explore: 'Exploring',
  culture: 'Culture',
  food: 'Food',
  beach: 'Beach',
  nightlife: 'Nightlife',
  adventure: 'Adventure',
  luxury: 'Luxury',
};

export const OPTIMISATION_MODE_LABELS: Record<OptimisationMode, string> = {
  best_value: 'Best overall value',
  cheapest: 'Cheapest trip',
  nicest_within_budget: 'Nicest within budget',
  maximise_beach_time: 'Most beach time',
  maximise_hotel_quality: 'Best hotel',
  maximise_food_quality: 'Best food',
  maximise_exploration: 'Most to explore',
};

/** Airport codes as typed: `VIE, BTS` or `vie bts`. */
const airportList = (label: string) =>
  z
    .string()
    .trim()
    .min(1, `Enter at least one ${label}.`)
    .transform((value) => value.split(/[\s,]+/).filter(Boolean))
    .pipe(
      z
        .array(z.string().regex(/^[A-Za-z]{3}$/, 'Use three-letter airport codes, such as VIE.'))
        .min(1, `Enter at least one ${label}.`),
    )
    .transform((codes) => codes.map((code) => code.toUpperCase()));

const isoDate = (label: string) => z.string().trim().refine(isIsoDate, `Enter ${label} as a date.`);

/** An unchecked checkbox submits nothing at all, which must read as false. */
const checkbox = z
  .union([z.literal('on'), z.literal('true'), z.literal('false'), z.literal('')])
  .optional()
  .transform((value) => value === 'on' || value === 'true');

const optionalNumber = (message: string) =>
  z
    .string()
    .trim()
    .optional()
    .transform((value) => (value === undefined || value === '' ? null : Number(value)))
    .refine((value) => value === null || Number.isFinite(value), message);

const wholeNumber = (label: string) =>
  z.coerce
    .number({ error: `Enter ${label} as a number.` })
    .int(`Enter ${label} as a whole number.`);

export const searchFormSchema = z.object({
  origins: airportList('departure airport'),
  destinations: airportList('destination'),
  earliestDeparture: isoDate('the earliest departure'),
  latestReturn: isoDate('the latest return'),
  minNights: wholeNumber('the shortest trip').min(1, 'A trip is at least one night.'),
  maxNights: wholeNumber('the longest trip').min(1, 'A trip is at least one night.'),
  passengers: wholeNumber('the number of travellers')
    .min(1, 'At least one traveller.')
    .max(9, 'Nine travellers at most.'),
  currency: z
    .string()
    .trim()
    .regex(/^[A-Za-z]{3}$/, 'Use a three-letter currency code, such as EUR.')
    .transform((value) => value.toUpperCase()),
  targetBudget: z.coerce
    .number({ error: 'Enter a target budget.' })
    .positive('A target budget is more than zero.'),
  maxBudget: z.coerce
    .number({ error: 'Enter a maximum budget.' })
    .positive('A maximum budget is more than zero.'),
  reserveBudget: optionalNumber('Enter the reserve as a number.'),
  travelStyle: z.enum(TRAVEL_STYLES),
  optimisationMode: z.enum(OPTIMISATION_MODES),
  requireDirectFlights: checkbox,
  requireCheckedBaggage: checkbox,
  requireFreeCancellation: checkbox,
  minHotelReviewScore: optionalNumber('Enter a review score between 0 and 10.'),
  maxBeachDistanceMetres: optionalNumber('Enter a distance in metres.'),
});

export type SearchFormValues = z.infer<typeof searchFormSchema>;
export type SearchFormField = keyof z.input<typeof searchFormSchema>;

/** Field-keyed messages, plus `form` for anything that spans several fields. */
export type SearchFormErrors = Partial<Record<SearchFormField | 'form', string>>;

/**
 * Cross-field rules.
 *
 * Kept out of the schema so each message can name the field the user should
 * actually change, rather than attaching to whichever field Zod happened to
 * validate last.
 */
function checkCrossFieldRules(values: SearchFormValues): SearchFormErrors {
  const errors: SearchFormErrors = {};

  if (values.maxNights < values.minNights) {
    errors.maxNights = 'The longest trip cannot be shorter than the shortest.';
  }

  if (values.latestReturn <= values.earliestDeparture) {
    errors.latestReturn = 'The latest return must be after the earliest departure.';
  }

  if (values.maxBudget < values.targetBudget) {
    errors.maxBudget = 'The maximum cannot be below the target.';
  }

  if (values.reserveBudget !== null && values.reserveBudget >= values.targetBudget) {
    errors.reserveBudget = 'The reserve must be less than the target budget.';
  }

  if (
    values.minHotelReviewScore !== null &&
    (values.minHotelReviewScore < 0 || values.minHotelReviewScore > 10)
  ) {
    errors.minHotelReviewScore = 'Review scores run from 0 to 10.';
  }

  if (values.maxBeachDistanceMetres !== null && values.maxBeachDistanceMetres < 0) {
    errors.maxBeachDistanceMetres = 'A distance cannot be negative.';
  }

  return errors;
}

export function toSearchProfile(values: SearchFormValues): SearchProfile {
  return {
    passengers: values.passengers,
    origins: values.origins,
    minNights: values.minNights,
    maxNights: values.maxNights,
    earliestDeparture: values.earliestDeparture,
    latestReturn: values.latestReturn,
    targetBudget: fromMajor(values.targetBudget, values.currency),
    maxBudget: fromMajor(values.maxBudget, values.currency),
    reserveBudget:
      values.reserveBudget === null ? null : fromMajor(values.reserveBudget, values.currency),
    travelStyle: values.travelStyle,
    optimisationMode: values.optimisationMode,
    requireDirectFlights: values.requireDirectFlights,
    requireCheckedBaggage: values.requireCheckedBaggage,
    requireFreeCancellation: values.requireFreeCancellation,
    minHotelReviewScore: values.minHotelReviewScore,
    maxBeachDistanceMetres: values.maxBeachDistanceMetres,
  };
}

/**
 * Parse raw form or query-string input into a search request.
 *
 * Returns a `Result` rather than throwing: an invalid form is an expected
 * outcome the page re-renders with messages beside the offending fields, not an
 * exception.
 */
export function parseSearchForm(
  input: Readonly<Record<string, string | undefined>>,
): Result<{ request: SearchRequest; values: SearchFormValues }, SearchFormErrors> {
  const parsed = searchFormSchema.safeParse(input);

  if (!parsed.success) {
    const errors: SearchFormErrors = {};

    for (const issue of parsed.error.issues) {
      const field = issue.path[0];
      const key = (typeof field === 'string' ? field : 'form') as SearchFormField | 'form';
      // Keep the first message per field: five complaints about one input is
      // noise, and the first is the one to act on.
      errors[key] ??= issue.message;
    }

    return err(errors);
  }

  const crossFieldErrors = checkCrossFieldRules(parsed.data);
  if (Object.keys(crossFieldErrors).length > 0) return err(crossFieldErrors);

  return ok({
    request: { profile: toSearchProfile(parsed.data), destinations: parsed.data.destinations },
    values: parsed.data,
  });
}
