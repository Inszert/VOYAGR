import { fromMajor, type Money } from '@/core/money';
import type { SearchProfile } from '@/core/trip/types';
import { AppError } from '@/lib/errors';
import { getLogger } from '@/lib/logger';
import { parsedTripRequestSchema, type ParsedTripRequest } from './types';

/**
 * AI guardrails.
 *
 * Specification section 23 draws a hard line: the model reasons and explains,
 * deterministic software owns prices, totals, dates and constraints. A line like
 * that only holds if something enforces it, which is what this module does.
 *
 * Three enforcement points:
 *  1. `validateParsedRequest` - model output is schema-checked and range-checked
 *     before it can influence a search.
 *  2. `toSearchProfile` - parsed intent becomes a profile through deterministic
 *     conversion, with budgets turned into `Money` here rather than by the model.
 *  3. `assertNoInventedFigures` - generated prose is scanned for numbers that do
 *     not appear in the facts it was given, so a hallucinated price cannot reach
 *     a user.
 */

const log = getLogger('ai.guardrails');

/** Model output that fails validation is discarded, never repaired in place. */
export function validateParsedRequest(raw: unknown): ParsedTripRequest {
  const result = parsedTripRequestSchema.safeParse(raw);

  if (!result.success) {
    const issues = result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
    log.warn({ issues }, 'discarded malformed AI request parse');

    throw new AppError(
      'AI_GUARDRAIL_VIOLATION',
      `AI returned an invalid trip request: ${issues.join('; ')}`,
      {
        publicMessage: 'We could not understand that request. Try rephrasing it.',
        context: { issues },
      },
    );
  }

  const parsed = result.data;

  // Cross-field checks the schema cannot express on its own.
  if (parsed.minNights > parsed.maxNights) {
    throw new AppError(
      'AI_GUARDRAIL_VIOLATION',
      `AI returned minNights ${parsed.minNights} above maxNights ${parsed.maxNights}`,
      { publicMessage: 'We could not understand the trip length. Try rephrasing it.' },
    );
  }

  if (
    parsed.targetBudgetMajorUnits !== null &&
    parsed.maxBudgetMajorUnits !== null &&
    parsed.targetBudgetMajorUnits > parsed.maxBudgetMajorUnits
  ) {
    throw new AppError(
      'AI_GUARDRAIL_VIOLATION',
      'AI returned a target budget above the maximum budget',
      { publicMessage: 'We could not understand the budget. Try rephrasing it.' },
    );
  }

  return parsed as ParsedTripRequest;
}

export interface ProfileDefaults {
  readonly earliestDeparture: string;
  readonly latestReturn: string;
  readonly fallbackTargetBudget: Money;
  readonly fallbackMaxBudget: Money;
}

/**
 * Convert validated model output into a `SearchProfile`.
 *
 * Every numeric field is produced here, deterministically. The model supplied
 * *intent* ("about 850 euros"); this function turns intent into the exact
 * `Money` value the engines will enforce.
 */
export function toSearchProfile(
  parsed: ParsedTripRequest,
  resolvedOrigins: readonly string[],
  defaults: ProfileDefaults,
): SearchProfile {
  const currency = parsed.currency.toUpperCase();

  const targetBudget =
    parsed.targetBudgetMajorUnits === null
      ? defaults.fallbackTargetBudget
      : fromMajor(parsed.targetBudgetMajorUnits, currency);

  const maxBudget =
    parsed.maxBudgetMajorUnits === null
      ? defaults.fallbackMaxBudget
      : fromMajor(parsed.maxBudgetMajorUnits, currency);

  return {
    passengers: parsed.passengers,
    origins: resolvedOrigins.length > 0 ? resolvedOrigins : parsed.origins,
    minNights: parsed.minNights,
    maxNights: parsed.maxNights,
    earliestDeparture: defaults.earliestDeparture,
    latestReturn: defaults.latestReturn,
    targetBudget,
    maxBudget,
    reserveBudget: null,
    travelStyle: parsed.travelStyle,
    optimisationMode: parsed.optimisationMode,
    requireDirectFlights: parsed.requireDirectFlights,
    requireCheckedBaggage: parsed.requireCheckedBaggage,
    requireFreeCancellation: false,
    minHotelReviewScore: null,
    maxBeachDistanceMetres: null,
  };
}

/** Numbers that carry no risk of being mistaken for a figure of record. */
const HARMLESS_NUMBERS = new Set(['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '24']);

/**
 * Extract every numeric token from a string, normalised for comparison.
 *
 * Thousands separators and currency symbols are stripped so that "1,234.00" and
 * "1234" compare equal - the concern is invented *figures*, not formatting.
 */
export function extractNumbers(text: string): string[] {
  const matches = text.match(/\d[\d,. ]*\d|\d/g) ?? [];

  return matches
    .map((match) => match.replaceAll(/[,\s]/g, ''))
    .map((match) => (match.includes('.') ? match.replace(/\.?0+$/, '') : match))
    .filter((match) => match.length > 0);
}

/**
 * Reject generated prose that contains figures absent from its source facts.
 *
 * This is the last line of defence for section 23. If a model writes "now only
 * EUR 612" when the real total is EUR 742, the sentence is thrown away rather
 * than shown - a wrong price is worse than no prose at all.
 *
 * @param generated - the model-written text.
 * @param allowedSources - the fact strings the model was given.
 * @throws AppError with code `AI_GUARDRAIL_VIOLATION` on an unsupported figure.
 */
export function assertNoInventedFigures(
  generated: string,
  allowedSources: readonly string[],
  context: { field: string },
): void {
  const allowed = new Set<string>();
  for (const source of allowedSources) {
    for (const value of extractNumbers(source)) allowed.add(value);
  }

  const invented = extractNumbers(generated).filter(
    (value) => !allowed.has(value) && !HARMLESS_NUMBERS.has(value),
  );

  if (invented.length > 0) {
    log.warn({ field: context.field, invented }, 'AI output contained unsupported figures');

    throw new AppError(
      'AI_GUARDRAIL_VIOLATION',
      `AI ${context.field} contained figures absent from the source facts: ${invented.join(', ')}`,
      {
        publicMessage: 'We could not generate a reliable explanation for this trip.',
        context: { field: context.field, invented },
      },
    );
  }
}

/**
 * Run the guardrail but degrade gracefully.
 *
 * Explanations are a nice-to-have; a trip card must still render without one.
 * Returns the fallback rather than throwing when the check fails.
 */
export function withFigureGuard<T extends string>(
  generated: T,
  allowedSources: readonly string[],
  context: { field: string },
  fallback: T,
): T {
  try {
    assertNoInventedFigures(generated, allowedSources, context);
    return generated;
  } catch {
    return fallback;
  }
}
