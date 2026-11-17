import { z } from 'zod';
import { fromMajor, toMajor } from '@/core/money';
import { addDays, isIsoDate } from '@/core/dates';
import type { OptimisationMode, SearchProfile, TravelStyle } from '@/core/trip/types';
import { err, ok, type Result } from '@/lib/result';
import {
  DEFAULT_PART_WEIGHTS,
  isDefaultPartWeights,
  PART_WEIGHT_MAX,
  PART_WEIGHT_MIN,
  type PartWeights,
} from '@/core/trip/scoring';
import { PART_WEIGHT_PARAMS } from './part-weight-params';
import type { SearchRequest } from './types';
import {
  applyFlexibility,
  FLEXIBILITY_PRESETS,
  type DateFlexibility,
  type FlexibilityPreset,
} from './flexibility';

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

/**
 * The word somebody types when they do not care where they go.
 *
 * "Anywhere" is a real answer to "where to?", and a search that refuses it
 * and demands three-letter codes is a search that only serves people who
 * already know where they are going - which is the opposite of what this
 * product is for. It expands to every destination we can actually price, so
 * it is a promise we can keep rather than a wildcard.
 */
export const ANYWHERE = 'anywhere';

export function isAnywhere(value: string | undefined): boolean {
  return (value ?? '').trim().toLowerCase() === ANYWHERE;
}

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

/**
 * Days of the week as `5,6`. Empty or absent means "any day".
 *
 * Only exists so a profile survives a round trip through a URL - it is what a
 * saved Travel Watch replays from. People pick days with the flexibility
 * chips, never by typing this.
 */
const daysOfWeek = z
  .string()
  .trim()
  .optional()
  .transform((value) => {
    if (value === undefined || value === '') return null;

    const days = value
      .split(',')
      .map((part) => Number(part.trim()))
      .filter((day) => Number.isInteger(day) && day >= 0 && day <= 6);

    return days.length > 0 ? days : null;
  });

const optionalIsoDate = z
  .string()
  .trim()
  .optional()
  .transform((value) => (value === undefined || value === '' ? null : value));

/**
 * The flexibility control (1.10.1 section 8).
 *
 * `custom` means "use the four window fields as given", which is what every
 * link written before this control existed does - including the ones a saved
 * Travel Watch replays. Absent reads as `custom` for exactly that reason.
 */
export const FLEXIBILITY_CHOICES = [...FLEXIBILITY_PRESETS, 'custom'] as const;

export type FlexibilityChoice = (typeof FLEXIBILITY_CHOICES)[number];

export const searchFormSchema = z.object({
  flexibility: z.enum(FLEXIBILITY_CHOICES).optional().default('custom'),
  /** The dates a person actually typed. Widened by the chosen preset. */
  departureDate: optionalIsoDate,
  returnDate: optionalIsoDate,
  departureDays: daysOfWeek,
  returnDays: daysOfWeek,
  origins: airportList('departure airport'),
  /*
   * `anywhere` is substituted before validation reaches here, in
   * `expandAnywhere` - by this point it is a list of codes like any other.
   */
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
  /*
   * Named, because an unnamed `z.enum` prints its own alternatives.
   *
   * A visitor whose link is missing one of these was shown `Invalid option:
   * expected one of "balanced"|"full_chill"|"chill"|...` under the field -
   * a developer's sentence, on a page, in production.
   */
  travelStyle: z.enum(TRAVEL_STYLES, { error: 'Choose one of the listed travel styles.' }),
  optimisationMode: z.enum(OPTIMISATION_MODES, {
    error: 'Choose one of the listed ways to rank trips.',
  }),
  requireDirectFlights: checkbox,
  maxStops: optionalNumber('Choose how many stops are acceptable.'),
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

  if (values.flexibility !== 'custom') {
    // A preset widens the dates a person typed, so it needs them. Validated
    // here rather than as a required field, because they are genuinely
    // optional on the custom path every pre-existing link uses.
    if (values.departureDate === null || !isIsoDate(values.departureDate)) {
      errors.departureDate = 'Enter the date you would like to leave.';
    } else if (values.returnDate === null || !isIsoDate(values.returnDate)) {
      errors.returnDate = 'Enter the date you would like to come back.';
    } else if (values.returnDate <= values.departureDate) {
      errors.returnDate = 'The return must be after the departure.';
    }

    // The window fields are derived from the preset, so a complaint about them
    // would name a field the user cannot see, let alone fix.
    return errors;
  }

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

  if (
    values.maxStops !== null &&
    (!Number.isInteger(values.maxStops) || values.maxStops < 0 || values.maxStops > 3)
  ) {
    errors.maxStops = 'Choose between direct and three stops.';
  }

  if (values.maxBeachDistanceMetres !== null && values.maxBeachDistanceMetres < 0) {
    errors.maxBeachDistanceMetres = 'A distance cannot be negative.';
  }

  return errors;
}

/**
 * The travel window a submission describes.
 *
 * One place decides this, because two would drift: the profile the search runs
 * and the summary the page prints must agree about what "a long weekend" meant.
 *
 * A preset widens the two dates the person typed. `custom` takes the four
 * window fields verbatim, which is both the escape hatch section 8 asks for
 * and what every link written before the presets existed already sends.
 */
export function resolveDateFlexibility(values: SearchFormValues): DateFlexibility {
  if (
    values.flexibility !== 'custom' &&
    values.departureDate !== null &&
    values.returnDate !== null
  ) {
    // The window fields submitted alongside are ignored, not merged: the home
    // form posts its own discovery window as hidden fields, and treating those
    // as a minimum somebody chose would pin every flexible search at four nights.
    return applyFlexibility(
      values.flexibility as FlexibilityPreset,
      values.departureDate,
      values.returnDate,
    );
  }

  return {
    earliestDeparture: values.earliestDeparture,
    latestReturn: values.latestReturn,
    minNights: values.minNights,
    maxNights: values.maxNights,
    departureDaysOfWeek: values.departureDays,
    returnDaysOfWeek: values.returnDays,
  };
}

export function toSearchProfile(values: SearchFormValues): SearchProfile {
  const dates = resolveDateFlexibility(values);

  return {
    passengers: values.passengers,
    origins: values.origins,
    minNights: dates.minNights,
    maxNights: dates.maxNights,
    earliestDeparture: dates.earliestDeparture,
    latestReturn: dates.latestReturn,
    departureDaysOfWeek: dates.departureDaysOfWeek,
    returnDaysOfWeek: dates.returnDaysOfWeek,
    targetBudget: fromMajor(values.targetBudget, values.currency),
    maxBudget: fromMajor(values.maxBudget, values.currency),
    reserveBudget:
      values.reserveBudget === null ? null : fromMajor(values.reserveBudget, values.currency),
    travelStyle: values.travelStyle,
    optimisationMode: values.optimisationMode,
    requireDirectFlights: values.requireDirectFlights,
    maxStops: values.maxStops,
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
/**
 * "Anytime that month" is chosen with a month and a trip length, not two dates.
 *
 * The form sends `monthStart` (the first day of the month, or today for the
 * current one) and `tripNights`; the two dates the month preset works from are
 * derived here, so the person never has to type days they do not care about.
 * Anything missing or unreadable leaves the typed dates alone.
 */
export function withMonthSelection(
  input: Readonly<Record<string, string | undefined>>,
): Readonly<Record<string, string | undefined>> {
  if (input.flexibility !== 'month') return input;

  const start = input.monthStart;
  if (typeof start !== 'string' || !isIsoDate(start)) return input;

  const parsed = Number(input.tripNights);
  const nights = Number.isInteger(parsed) && parsed >= 1 && parsed <= 30 ? parsed : 7;

  return { ...input, departureDate: start, returnDate: addDays(start, nights) };
}

/**
 * How much each part of the trip matters, from `?wStay=&wTransfers=&wCost=&wNature=&wWeather=&wFood=`
 * (the retired `wFlights` and `wActivities` are ignored, not an error).
 *
 * Absent, empty, unreadable or out of 0..2 all mean "as normal" (1): a link
 * that cannot be understood must never reorder results in a way nobody chose.
 * Returns undefined when nothing differs from the default, so the default
 * request is byte-for-byte the request it always was.
 */
export function parsePartWeights(
  input: Readonly<Record<string, string | undefined>>,
): PartWeights | undefined {
  const weights = { ...DEFAULT_PART_WEIGHTS } as { -readonly [K in keyof PartWeights]: number };

  for (const part of Object.keys(PART_WEIGHT_PARAMS) as (keyof PartWeights)[]) {
    const raw = input[PART_WEIGHT_PARAMS[part]]?.trim();
    if (!raw) continue;
    const value = Number(raw);
    if (!Number.isFinite(value) || value < PART_WEIGHT_MIN || value > PART_WEIGHT_MAX) continue;
    // Quarter steps: the control moves in halves, and a hand-typed 1.3337 is not a preference.
    weights[part] = Math.round(value * 4) / 4;
  }

  return isDefaultPartWeights(weights) ? undefined : weights;
}

export function parseSearchForm(
  input: Readonly<Record<string, string | undefined>>,
  /**
   * Every destination we can actually price, for `anywhere`.
   *
   * Passed in rather than imported so this module stays free of the
   * destination catalogue - the schema's job is to say what a valid request
   * looks like, not to know where the product currently flies.
   */
  anywhere: readonly string[] = [],
  /**
   * Turns a region word ("oceania") into its destination codes, or null if the
   * word is not one. Injected for the same reason `anywhere` is.
   */
  resolveRegion?: (value: string | undefined) => readonly string[] | null,
): Result<{ request: SearchRequest; values: SearchFormValues }, SearchFormErrors> {
  /*
   * `anywhere` becomes a list before validation, not after.
   *
   * Substituting here means everything downstream - the schema, the plan,
   * the fan-out bounds, the diagnostics - deals in codes and has no idea the
   * word was ever typed. The alternative is a special case in each of them.
   */
  const base = withMonthSelection(input);
  const region = resolveRegion?.(base.destinations) ?? null;
  const expanded =
    isAnywhere(base.destinations) && anywhere.length > 0
      ? { ...base, destinations: anywhere.join(', ') }
      : // A region the catalogue has nothing in stays as typed, so the form
        // says it is not a destination rather than searching the wrong place.
        region && region.length > 0
        ? { ...base, destinations: region.join(', ') }
        : base;

  const parsed = searchFormSchema.safeParse(expanded);

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

  const partWeights = parsePartWeights(input);

  return ok({
    request: {
      profile: toSearchProfile(parsed.data),
      destinations: parsed.data.destinations,
      ...(partWeights ? { partWeights } : {}),
    },
    values: parsed.data,
  });
}

/**
 * The inverse of `parseSearchForm`: a profile back into a query string.
 *
 * Exists because a saved search has to be re-runnable, and a hand-built link
 * that lists "most of" the fields silently drops the user's hard constraints —
 * someone who saved "direct flights only, free cancellation" gets results
 * ignoring both, which looks like the system forgetting what they asked for.
 *
 * Every field of `SearchProfile` is written here. A round-trip test asserts
 * that parsing the output reproduces the input, so adding a field to the
 * profile and forgetting it here fails a test rather than quietly losing a
 * constraint.
 */
export function searchProfileToQuery(
  profile: SearchProfile,
  destinations: readonly string[],
): string {
  const currency = profile.targetBudget.currency;

  const params: Record<string, string> = {
    origins: profile.origins.join(', '),
    destinations: destinations.join(', '),
    earliestDeparture: profile.earliestDeparture,
    latestReturn: profile.latestReturn,
    minNights: String(profile.minNights),
    maxNights: String(profile.maxNights),
    passengers: String(profile.passengers),
    currency,
    // `toMajor` rather than dividing by 100: not every currency has two decimal
    // places, and the money module is the only thing that knows which.
    targetBudget: String(toMajor(profile.targetBudget)),
    maxBudget: String(toMajor(profile.maxBudget)),
    travelStyle: profile.travelStyle,
    optimisationMode: profile.optimisationMode,
  };

  /*
   * Always the resolved window, never the preset that produced it.
   *
   * A saved Travel Watch replays this string months later. "A long weekend"
   * re-derived at replay time would quietly slide six weeks forward from
   * whenever the worker happened to run, so the watch would stop being the
   * search the user saved. The dates are the promise; the preset was only how
   * they were typed.
   */
  if (profile.departureDaysOfWeek) params.departureDays = profile.departureDaysOfWeek.join(',');
  if (profile.returnDaysOfWeek) params.returnDays = profile.returnDaysOfWeek.join(',');

  if (profile.reserveBudget) params.reserveBudget = String(toMajor(profile.reserveBudget));
  if (profile.minHotelReviewScore !== null) {
    params.minHotelReviewScore = String(profile.minHotelReviewScore);
  }
  if (profile.maxBeachDistanceMetres !== null) {
    params.maxBeachDistanceMetres = String(profile.maxBeachDistanceMetres);
  }

  // An unchecked box submits nothing, so only a true requirement is written.
  if (profile.maxStops !== null && profile.maxStops !== undefined) {
    params.maxStops = String(profile.maxStops);
  }
  if (profile.requireDirectFlights) params.requireDirectFlights = 'on';
  if (profile.requireCheckedBaggage) params.requireCheckedBaggage = 'on';
  if (profile.requireFreeCancellation) params.requireFreeCancellation = 'on';

  return new URLSearchParams(params).toString();
}
